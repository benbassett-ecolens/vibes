"""The live provider, exercised against a fake yfinance.

Everything here runs offline. The shapes the fake reproduces were read out of
the installed yfinance 1.7.0, not guessed.
"""

import sys

import pytest

from fake_yfinance import FakeYFinance, make_frame, news_item
from stock_deal_desk.config import ScreenConfig
from stock_deal_desk.providers.yahoo import DEFAULT_UNIVERSE, YahooProvider


@pytest.fixture
def fake(monkeypatch):
    def _install(**kwargs):
        module = FakeYFinance(**kwargs)
        monkeypatch.setitem(sys.modules, "yfinance", module)
        return module
    return _install


def quote(symbol, **overrides):
    base = {
        "symbol": symbol, "shortName": f"{symbol} Corp", "sector": "Energy",
        "regularMarketPrice": 12.0, "trailingPE": 33.0, "dividendYield": 3.5,
        "marketCap": 5e9, "averageDailyVolume3Month": 4_000_000,
        "sharesOutstanding": 4.1e8,
    }
    base.update(overrides)
    return base


# ------------------------------------------------------------------ universe

def test_universe_comes_from_the_screener(fake):
    fake(quotes=[quote("AAA"), quote("BBB")])
    provider = YahooProvider()
    assert list(provider.universe()) == ["AAA", "BBB"]
    assert provider.universe_source == "screener"
    assert "screener" in provider.describe()


def test_screen_config_is_pushed_into_the_query(fake):
    module = fake(quotes=[quote("AAA")])
    cfg = ScreenConfig(pe_min=25.0, pe_max=150.0, price_min=3.0, price_max=25.0)
    YahooProvider(screen=cfg).universe()

    query = module.screen_calls[0]["query"]
    fields = query.fields()
    assert "peratio.lasttwelvemonths" in fields
    assert "intradayprice" in fields
    assert "intradaymarketcap" in fields
    assert "avgdailyvol3m" in fields
    assert query.clause("region")[1] == "us"


def test_the_server_side_net_is_looser_than_the_desk_screen(fake):
    """Yahoo must never tighten the desk's own criteria."""
    module = fake(quotes=[quote("AAA")])
    cfg = ScreenConfig(pe_min=25.0, pe_max=150.0, price_min=3.0, price_max=25.0)
    YahooProvider(screen=cfg).universe()
    query = module.screen_calls[0]["query"]

    _, pe_low, pe_high = query.clause("peratio.lasttwelvemonths")
    assert pe_low < cfg.pe_min and pe_high > cfg.pe_max
    _, px_low, px_high = query.clause("intradayprice")
    assert px_low < cfg.price_min and px_high > cfg.price_max


def test_a_dividend_requirement_is_sent_in_percent(fake):
    module = fake(quotes=[quote("AAA")])
    cfg = ScreenConfig(require_dividend=True, min_dividend_yield=0.04)
    YahooProvider(screen=cfg).universe()
    clause = module.screen_calls[0]["query"].clause("dividendyield")
    assert clause is not None
    assert 3.0 < clause[1] < 4.0     # 4% expressed as ~3.4 after slack, not 0.04


def test_no_dividend_clause_when_none_is_required(fake):
    module = fake(quotes=[quote("AAA")])
    YahooProvider(screen=ScreenConfig(require_dividend=False)).universe()
    assert module.screen_calls[0]["query"].clause("dividendyield") is None


def test_a_broken_screener_falls_back_to_the_static_watchlist(fake):
    fake(screen_error=RuntimeError("Yahoo is down"))
    provider = YahooProvider()
    assert list(provider.universe()) == DEFAULT_UNIVERSE
    assert provider.universe_source == "fallback"
    assert "static watchlist" in provider.describe()


def test_explicit_tickers_skip_the_screener_entirely(fake):
    module = fake(quotes=[quote("AAA")])
    provider = YahooProvider(tickers=["msft", " ko "])
    assert list(provider.universe()) == ["MSFT", "KO"]
    assert provider.universe_source == "explicit"
    assert module.screen_calls == []


def test_the_candidate_cap_is_respected(fake):
    fake(quotes=[quote(f"T{i}") for i in range(50)])
    assert len(YahooProvider(max_candidates=5).universe()) == 5


# -------------------------------------------------------------- fundamentals

def test_fundamentals_merge_screener_quote_and_info(fake):
    fake(quotes=[quote("AAA")],
         info={"AAA": {"payoutRatio": 0.62, "sector": "Healthcare", "trailingEps": 0.36}})
    provider = YahooProvider()
    provider.universe()
    f = provider.fundamentals("AAA")
    assert f.payout_ratio == 0.62         # only .info has this
    assert f.sector == "Healthcare"       # .info wins over the quote
    assert f.pe_trailing == 33.0          # from the quote
    assert f.avg_dollar_volume == pytest.approx(4_000_000 * 12.0)


@pytest.mark.parametrize("raw,expected", [
    (3.5, 0.035),      # Yahoo percent form
    (0.035, 0.035),    # Yahoo decimal form
    (0, 0.0),
    (None, 0.0),
])
def test_dividend_yield_is_normalised_to_a_decimal(fake, raw, expected):
    fake(quotes=[quote("AAA", dividendYield=raw)])
    provider = YahooProvider()
    provider.universe()
    assert provider.fundamentals("AAA").dividend_yield == pytest.approx(expected)


def test_missing_price_yields_no_fundamentals(fake):
    fake(quotes=[quote("AAA", regularMarketPrice=None)], info={"AAA": {}})
    provider = YahooProvider()
    provider.universe()
    assert provider.fundamentals("AAA") is None


def test_nan_fields_become_none_not_nan(fake):
    fake(quotes=[quote("AAA", trailingPE=float("nan"))], info={"AAA": {}})
    provider = YahooProvider()
    provider.universe()
    assert provider.fundamentals("AAA").pe_trailing is None


def test_info_is_fetched_once_per_ticker(fake):
    module = fake(quotes=[quote("AAA")], info={"AAA": {"payoutRatio": 0.5}})
    provider = YahooProvider()
    provider.universe()
    for _ in range(4):
        provider.fundamentals("AAA")
    assert module.info_calls == ["AAA"]


# ------------------------------------------------------------------- history

def test_history_is_fetched_in_one_batched_call(fake):
    module = fake(quotes=[quote("AAA"), quote("BBB")])
    provider = YahooProvider()
    provider.history("AAA")
    provider.history("BBB")
    provider.benchmark_history()
    assert len(module.download_calls) == 1
    assert set(module.download_calls[0]["symbols"]) == {"AAA", "BBB", "SPY"}


def test_batched_history_is_parsed_per_symbol(fake):
    fake(quotes=[quote("AAA"), quote("BBB")],
         frames={"AAA": make_frame(n=100, start=5.0),
                 "BBB": make_frame(n=100, start=50.0)})
    provider = YahooProvider()
    assert len(provider.history("AAA")) == 100
    assert provider.history("AAA")[0].close == pytest.approx(5.0)
    assert provider.history("BBB")[0].close == pytest.approx(50.0)


def test_nan_rows_are_dropped_rather_than_poisoning_the_series(fake):
    fake(quotes=[quote("AAA")], frames={"AAA": make_frame(n=50, with_nan_row=True)})
    provider = YahooProvider()
    bars = provider.history("AAA")
    assert len(bars) == 49
    assert all(b.close == b.close for b in bars)


def test_a_failed_batch_download_falls_back_per_ticker(fake):
    module = fake(quotes=[quote("AAA")], download_error=RuntimeError("rate limited"))
    provider = YahooProvider()
    assert len(provider.history("AAA")) > 0
    assert len(module.download_calls) == 1     # tried the batch, then went per-ticker


def test_an_unknown_ticker_has_empty_history(fake):
    fake(quotes=[quote("AAA")])
    provider = YahooProvider()
    provider.history("AAA")
    assert provider.history("ZZZZ") == []


# ---------------------------------------------------------------------- news

def test_news_is_parsed_from_the_content_envelope(fake):
    fake(quotes=[quote("AAA")],
         news={"AAA": [news_item("Company raises guidance", source="Bloomberg")]})
    provider = YahooProvider()
    headlines = provider.headlines("AAA")
    assert len(headlines) == 1
    assert headlines[0].title == "Company raises guidance"
    assert headlines[0].source == "Bloomberg"
    assert headlines[0].date == "2026-08-27"


def test_untitled_and_ad_entries_are_skipped(fake):
    fake(quotes=[quote("AAA")],
         news={"AAA": [{"content": {"title": ""}}, news_item("Real headline")]})
    provider = YahooProvider()
    assert [h.title for h in provider.headlines("AAA")] == ["Real headline"]


def test_news_failures_are_not_fatal(fake):
    module = fake(quotes=[quote("AAA")])
    module._news = property(lambda self: (_ for _ in ()).throw(RuntimeError()))
    provider = YahooProvider()
    assert provider.headlines("AAA") == []


# ------------------------------------------------------------------ end-to-end

def test_the_desk_runs_against_the_live_provider(fake):
    fake(
        quotes=[quote("AAA", sector="Energy"), quote("BBB", sector="Healthcare")],
        info={"AAA": {"payoutRatio": 0.55}, "BBB": {"payoutRatio": 0.60}},
        news={"AAA": [news_item("AAA raises guidance and beats estimates")]},
        frames={s: make_frame(n=300) for s in ("AAA", "BBB", "SPY")},
    )
    from stock_deal_desk import DealDesk
    run = DealDesk(provider=YahooProvider()).run()
    assert run.provider_is_live is True
    assert run.provider_synthetic is False
    assert run.universe_size == 2
    assert len(run.recommendations) == 2
