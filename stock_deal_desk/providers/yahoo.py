"""Live provider backed by yfinance.

Requires outbound network access to Yahoo Finance. Install with::

    pip install yfinance

Yahoo is a free, best-effort, frequently-rate-limited source. Fields come back
missing or stale often enough that every accessor here degrades to None rather
than raising -- the screen treats a missing P/E as "cannot confirm, exclude".
"""

from __future__ import annotations

from typing import Sequence

from ..models import Bar, Fundamentals, Headline

DEFAULT_UNIVERSE = [
    # A small, liquid starter universe skewed toward low nominal share prices,
    # which is where this desk's screen can actually find anything. Replace it
    # with your own list via DeskConfig / --universe.
    "F", "T", "VZ", "KMI", "PFE", "BAC", "KEY", "HBAN", "RF", "CFG",
    "NYCB", "WBA", "PARA", "SIRI", "AGNC", "NLY", "ARCC", "MPW", "IEP", "VTRS",
    "AMCR", "KHC", "CCL", "AAL", "SNAP", "PLUG", "NOK", "TFC", "SWN", "APA",
]


class YahooProvider:
    name = "yahoo"

    def __init__(self, tickers: Sequence[str] | None = None, benchmark: str = "SPY",
                 period: str = "2y") -> None:
        try:
            import yfinance  # noqa: F401
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise RuntimeError(
                "the yahoo provider needs yfinance: pip install yfinance"
            ) from exc
        self._tickers = list(tickers) if tickers else list(DEFAULT_UNIVERSE)
        self._benchmark = benchmark
        self._period = period
        self._cache: dict[str, object] = {}

    def is_live(self) -> bool:
        return True

    def universe(self) -> Sequence[str]:
        return list(self._tickers)

    def _ticker(self, symbol: str):
        import yfinance as yf
        if symbol not in self._cache:
            self._cache[symbol] = yf.Ticker(symbol)
        return self._cache[symbol]

    def fundamentals(self, ticker: str) -> Fundamentals | None:
        try:
            info = self._ticker(ticker).info or {}
        except Exception:
            return None
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if not price:
            return None
        volume = info.get("averageVolume") or info.get("averageDailyVolume10Day") or 0
        # Yahoo reports dividendYield inconsistently: sometimes 0.031, sometimes 3.1.
        raw_yield = info.get("dividendYield") or 0.0
        dividend_yield = raw_yield / 100.0 if raw_yield > 1.0 else raw_yield
        return Fundamentals(
            ticker=ticker,
            name=info.get("shortName") or ticker,
            sector=info.get("sector") or "Unknown",
            price=float(price),
            pe_trailing=_as_float(info.get("trailingPE")),
            pe_forward=_as_float(info.get("forwardPE")),
            eps_trailing=_as_float(info.get("trailingEps")),
            dividend_yield=float(dividend_yield),
            payout_ratio=_as_float(info.get("payoutRatio")),
            market_cap=float(info.get("marketCap") or 0.0),
            shares_out=float(info.get("sharesOutstanding") or 0.0),
            avg_dollar_volume=float(volume) * float(price),
        )

    def history(self, ticker: str) -> Sequence[Bar]:
        try:
            frame = self._ticker(ticker).history(period=self._period, interval="1d")
        except Exception:
            return []
        bars: list[Bar] = []
        for index, row in frame.iterrows():
            bars.append(Bar(
                date=str(index)[:10],
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row["Volume"]),
            ))
        return bars

    def headlines(self, ticker: str) -> Sequence[Headline]:
        try:
            items = self._ticker(ticker).news or []
        except Exception:
            return []
        out: list[Headline] = []
        for item in items:
            content = item.get("content", item)
            title = content.get("title") or ""
            if not title:
                continue
            provider = content.get("provider") or {}
            out.append(Headline(
                ticker=ticker,
                date=str(content.get("pubDate", ""))[:10],
                source=provider.get("displayName", "yahoo") if isinstance(provider, dict) else "yahoo",
                title=title,
            ))
        return out

    def benchmark_history(self) -> Sequence[Bar]:
        return self.history(self._benchmark)


def _as_float(value) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out != out else out   # drop NaN
