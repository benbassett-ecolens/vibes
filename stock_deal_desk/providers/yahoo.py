"""Live provider backed by yfinance.

Two things make this practical rather than a toy:

1. **Universe discovery is server-side.** Yahoo's screener endpoint accepts the
   P/E, price, yield, volume and market-cap bounds directly, so the desk
   discovers candidates across the whole US market instead of scoring a
   hardcoded watchlist. The server-side query is deliberately *looser* than the
   desk's own screen -- it is a coarse net, and `SetupHunterAgent._screen`
   remains the precise filter. That way a units mismatch at Yahoo's end can
   never silently tighten the desk's actual criteria.

2. **Prices are fetched in one batch.** ``yf.download`` pulls every candidate's
   history in a single call. Per-ticker ``.info`` is the expensive, heavily
   rate-limited path, so it is used only to fill the handful of fields the
   screener does not return (payout ratio above all).

Yahoo is free, unofficial and best-effort. Every accessor degrades to None or
an empty list rather than raising, and the desk treats a missing P/E as
"cannot confirm, exclude".
"""

from __future__ import annotations

import logging
from typing import Sequence

from ..config import ScreenConfig
from ..models import Bar, Fundamentals, Headline

logger = logging.getLogger(__name__)

#: Fallback watchlist, used only when the screener is unavailable. Skewed to
#: low nominal share prices, which is where this desk's screen can find
#: anything at all.
DEFAULT_UNIVERSE = [
    "F", "T", "VZ", "KMI", "PFE", "BAC", "KEY", "HBAN", "RF", "CFG",
    "WBA", "PARA", "SIRI", "AGNC", "NLY", "ARCC", "MPW", "IEP", "VTRS",
    "AMCR", "KHC", "CCL", "AAL", "SNAP", "PLUG", "NOK", "TFC", "SWN", "APA",
]

#: How much looser the server-side net is than the desk's own screen.
SCREEN_SLACK = 0.85


class YahooProvider:
    name = "yahoo"

    def __init__(self, tickers: Sequence[str] | None = None, benchmark: str = "SPY",
                 period: str = "2y", screen: ScreenConfig | None = None,
                 max_candidates: int = 40) -> None:
        try:
            import yfinance  # noqa: F401
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise RuntimeError(
                "the yahoo provider needs yfinance: pip install yfinance"
            ) from exc
        self._explicit = [t.strip().upper() for t in tickers] if tickers else None
        self._benchmark = benchmark
        self._period = period
        self._screen = screen or ScreenConfig()
        self._max_candidates = max_candidates
        self._universe: list[str] | None = None
        self._quotes: dict[str, dict] = {}
        self._info: dict[str, dict] = {}
        self._bars: dict[str, list[Bar]] | None = None
        self._news: dict[str, list[Headline]] = {}
        #: Set to "screener", "explicit" or "fallback" once the universe resolves.
        self.universe_source = "unresolved"

    #: Live quotes are never synthetic.
    synthetic = False

    def is_live(self) -> bool:
        return True

    def describe(self) -> str:
        source = {
            "screener": "universe discovered via Yahoo's screener",
            "explicit": "universe supplied with --universe",
            "fallback": "screener unavailable, using the static watchlist",
        }.get(self.universe_source, "universe unresolved")
        return f"live from Yahoo Finance ({source})"

    # ------------------------------------------------------------- universe

    def universe(self) -> Sequence[str]:
        if self._universe is not None:
            return self._universe
        if self._explicit:
            self.universe_source = "explicit"
            self._universe = list(self._explicit)
            return self._universe
        discovered = self._run_screener()
        if discovered:
            self.universe_source = "screener"
            self._universe = discovered
        else:
            self.universe_source = "fallback"
            self._universe = list(DEFAULT_UNIVERSE)
            logger.warning(
                "Yahoo screener unavailable; falling back to the %d-name static "
                "watchlist. Results reflect that list, not the whole market.",
                len(self._universe),
            )
        return self._universe

    def _screener_query(self):
        """Translate ScreenConfig into a Yahoo EquityQuery.

        Bounds are widened by SCREEN_SLACK so the desk's own screen stays the
        authority; this only decides which names are worth downloading.
        """
        import yfinance as yf
        from yfinance import EquityQuery as Q

        cfg = self._screen
        clauses = [
            Q("eq", ["region", "us"]),
            Q("btwn", ["peratio.lasttwelvemonths",
                       cfg.pe_min * SCREEN_SLACK, cfg.pe_max / SCREEN_SLACK]),
            Q("btwn", ["intradayprice",
                       cfg.price_min * SCREEN_SLACK, cfg.price_max / SCREEN_SLACK]),
            Q("gt", ["intradaymarketcap", cfg.min_market_cap * SCREEN_SLACK]),
        ]
        # avgdailyvol3m is share volume, not dollar volume. Convert using the
        # price ceiling, which is the conservative direction: it can only let
        # extra names through for the client-side dollar test to reject.
        if cfg.price_max > 0:
            min_shares = cfg.min_avg_dollar_volume * SCREEN_SLACK / cfg.price_max
            clauses.append(Q("gt", ["avgdailyvol3m", min_shares]))
        if cfg.require_dividend:
            # Yahoo reports screener yields in percent, the desk in decimals.
            clauses.append(Q("gt", ["dividendyield", cfg.min_dividend_yield * 100 * SCREEN_SLACK]))
        return yf.screen(Q("and", clauses), size=min(self._max_candidates, 250),
                         sortField="intradaymarketcap", sortAsc=False)

    def _run_screener(self) -> list[str]:
        try:
            response = self._screener_query()
        except Exception as exc:
            logger.warning("Yahoo screener call failed: %s", exc)
            return []
        quotes = (response or {}).get("quotes") or []
        symbols: list[str] = []
        for quote in quotes:
            symbol = quote.get("symbol")
            if not symbol:
                continue
            self._quotes[symbol] = quote
            symbols.append(symbol)
        return symbols[: self._max_candidates]

    # --------------------------------------------------------- fundamentals

    def fundamentals(self, ticker: str) -> Fundamentals | None:
        quote = self._quotes.get(ticker, {})
        info = self._get_info(ticker)
        if not quote and not info:
            return None

        price = _first(info.get("currentPrice"), info.get("regularMarketPrice"),
                       quote.get("regularMarketPrice"))
        if not price:
            return None

        share_volume = _first(info.get("averageVolume"),
                              info.get("averageDailyVolume10Day"),
                              quote.get("averageDailyVolume3Month")) or 0.0

        return Fundamentals(
            ticker=ticker,
            name=_first(info.get("shortName"), quote.get("shortName"), ticker),
            sector=_first(info.get("sector"), quote.get("sector"), "Unknown"),
            price=float(price),
            pe_trailing=_as_float(_first(info.get("trailingPE"), quote.get("trailingPE"))),
            pe_forward=_as_float(_first(info.get("forwardPE"), quote.get("forwardPE"))),
            eps_trailing=_as_float(_first(info.get("trailingEps"), quote.get("epsTrailingTwelveMonths"))),
            dividend_yield=_normalise_yield(
                _first(info.get("dividendYield"), quote.get("dividendYield"))),
            payout_ratio=_as_float(info.get("payoutRatio")),
            market_cap=float(_first(info.get("marketCap"), quote.get("marketCap")) or 0.0),
            shares_out=float(_first(info.get("sharesOutstanding"),
                                    quote.get("sharesOutstanding")) or 0.0),
            avg_dollar_volume=float(share_volume) * float(price),
        )

    def _get_info(self, ticker: str) -> dict:
        """Per-ticker .info, cached. The rate-limited path -- called sparingly."""
        if ticker in self._info:
            return self._info[ticker]
        try:
            info = self._ticker(ticker).info or {}
        except Exception as exc:
            logger.debug("%s: .info unavailable (%s)", ticker, exc)
            info = {}
        self._info[ticker] = info
        return info

    def _ticker(self, symbol: str):
        import yfinance as yf
        return yf.Ticker(symbol)

    # -------------------------------------------------------------- history

    def history(self, ticker: str) -> Sequence[Bar]:
        if self._bars is None:
            self._bars = self._download_all()
        return self._bars.get(ticker, [])

    def benchmark_history(self) -> Sequence[Bar]:
        return self.history(self._benchmark)

    def _download_all(self) -> dict[str, list[Bar]]:
        """One batched download for the whole universe plus the benchmark."""
        import yfinance as yf

        symbols = list(dict.fromkeys(list(self.universe()) + [self._benchmark]))
        try:
            frame = yf.download(
                symbols, period=self._period, interval="1d", group_by="ticker",
                auto_adjust=True, progress=False, threads=True,
            )
        except Exception as exc:
            logger.warning("batched download failed (%s); falling back per ticker", exc)
            return {s: self._download_one(s) for s in symbols}

        out: dict[str, list[Bar]] = {}
        for symbol in symbols:
            try:
                sub = frame[symbol] if len(symbols) > 1 else frame
            except (KeyError, TypeError):
                out[symbol] = self._download_one(symbol)
                continue
            out[symbol] = _frame_to_bars(sub)
        return out

    def _download_one(self, symbol: str) -> list[Bar]:
        try:
            return _frame_to_bars(
                self._ticker(symbol).history(period=self._period, interval="1d")
            )
        except Exception as exc:
            logger.debug("%s: history unavailable (%s)", symbol, exc)
            return []

    # ----------------------------------------------------------------- news

    def headlines(self, ticker: str) -> Sequence[Headline]:
        if ticker in self._news:
            return self._news[ticker]
        try:
            items = self._ticker(ticker).get_news(count=10) or []
        except Exception as exc:
            logger.debug("%s: news unavailable (%s)", ticker, exc)
            items = []
        out: list[Headline] = []
        for item in items:
            # yfinance returns stream entries whose payload sits under "content".
            content = item.get("content") or item
            title = content.get("title")
            if not title:
                continue
            provider = content.get("provider")
            source = provider.get("displayName", "yahoo") if isinstance(provider, dict) else "yahoo"
            out.append(Headline(
                ticker=ticker,
                date=str(content.get("pubDate") or content.get("displayTime") or "")[:10],
                source=source,
                title=title,
            ))
        self._news[ticker] = out
        return out


# ------------------------------------------------------------------ helpers

def _first(*values):
    """First value that is neither None nor an empty string."""
    for value in values:
        if value is not None and value != "":
            return value
    return None


def _as_float(value) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out != out else out   # drop NaN


def _normalise_yield(value) -> float:
    """Yahoo reports dividend yield as 0.031 in some fields and 3.1 in others."""
    parsed = _as_float(value)
    if parsed is None or parsed <= 0:
        return 0.0
    return parsed / 100.0 if parsed > 1.0 else parsed


def _frame_to_bars(frame) -> list[Bar]:
    """Convert a yfinance OHLCV frame into Bars, skipping incomplete rows."""
    if frame is None or getattr(frame, "empty", True):
        return []
    bars: list[Bar] = []
    for index, row in frame.iterrows():
        try:
            close = float(row["Close"])
        except (KeyError, TypeError, ValueError):
            continue
        if close != close:      # NaN row, common on holidays in batched frames
            continue
        bars.append(Bar(
            date=str(index)[:10],
            open=float(row["Open"]), high=float(row["High"]),
            low=float(row["Low"]), close=close,
            volume=float(row["Volume"] or 0.0),
        ))
    return bars
