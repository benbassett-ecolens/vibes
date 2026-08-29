"""Agent behaviour: the screen, the sentiment reader, and the risk vetoes."""

import pytest

from stock_deal_desk.agents import (
    MarketWatchAgent, NewsSentimentAgent, RiskManagerAgent, SetupHunterAgent,
)
from stock_deal_desk.bus import TOPIC_MARKET, TOPIC_RISK, TOPIC_SENTIMENT, TOPIC_SETUP
from stock_deal_desk.config import DeskConfig, RiskConfig, ScreenConfig
from stock_deal_desk.models import Regime, Setup, Verdict
from conftest import StubProvider, make_bars, make_fundamentals


# ------------------------------------------------------------------ agent one

def test_market_watch_defaults_to_neutral_without_enough_history(make_ctx, bus):
    ctx = make_ctx(StubProvider(benchmark=make_bars(n=50)))
    MarketWatchAgent().run(ctx)
    view = bus.latest(TOPIC_MARKET)
    assert view.regime is Regime.NEUTRAL
    assert "only 50 benchmark bars" in view.notes[0]


def test_market_watch_calls_a_calm_uptrend_risk_on(make_ctx, bus):
    provider = StubProvider(
        fundamentals={"A": make_fundamentals("A")},
        benchmark=make_bars(n=300, drift=0.0008, wiggle=0.002),
    )
    MarketWatchAgent().run(make_ctx(provider))
    assert bus.latest(TOPIC_MARKET).regime is Regime.RISK_ON


def test_market_watch_calls_a_falling_volatile_tape_risk_off(make_ctx, bus):
    # Falling *and* volatile. A quiet grind lower is deliberately not RISK_OFF.
    provider = StubProvider(benchmark=make_bars(n=300, drift=-0.0012, chop=0.03))
    MarketWatchAgent().run(make_ctx(provider))
    assert bus.latest(TOPIC_MARKET).regime is Regime.RISK_OFF


def test_a_quiet_grind_lower_is_only_neutral(make_ctx, bus):
    provider = StubProvider(benchmark=make_bars(n=300, drift=-0.0012, wiggle=0.004))
    MarketWatchAgent().run(make_ctx(provider))
    assert bus.latest(TOPIC_MARKET).regime is Regime.NEUTRAL


def test_risk_budget_shrinks_as_the_regime_deteriorates():
    assert Regime.RISK_ON.budget_multiplier > Regime.NEUTRAL.budget_multiplier
    assert Regime.NEUTRAL.budget_multiplier > Regime.RISK_OFF.budget_multiplier


# ------------------------------------------------------------------ agent two

@pytest.mark.parametrize("overrides,expected_fragment", [
    ({"pe_trailing": 12.0}, "below the 25"),
    ({"pe_trailing": 400.0}, "above 150"),
    ({"pe_trailing": None}, "no trailing P/E"),
    ({"price": 80.0}, "above the $25 price ceiling"),
    ({"price": 1.20}, "below the $3.00 floor"),
    ({"avg_dollar_volume": 100_000.0}, "too thin to trade"),
    ({"market_cap": 1e6}, "market cap below the floor"),
])
def test_screen_rejects_and_explains(make_ctx, bus, overrides, expected_fragment):
    provider = StubProvider(fundamentals={"X": make_fundamentals("X", **overrides)})
    SetupHunterAgent().run(make_ctx(provider))
    setup = bus.latest(TOPIC_SETUP)
    assert setup.passed_screen is False
    assert any(expected_fragment in r for r in setup.screen_reasons)


def test_screen_accepts_the_target_profile(make_ctx, bus):
    provider = StubProvider(fundamentals={"X": make_fundamentals("X")})
    SetupHunterAgent().run(make_ctx(provider))
    assert bus.latest(TOPIC_SETUP).passed_screen is True


def test_dividend_is_optional_by_default_and_required_when_configured(make_ctx, bus):
    no_dividend = {"X": make_fundamentals("X", dividend_yield=0.0, payout_ratio=None)}

    SetupHunterAgent().run(make_ctx(StubProvider(fundamentals=no_dividend)))
    assert bus.latest(TOPIC_SETUP).passed_screen is True

    bus.clear()
    strict = DeskConfig(screen=ScreenConfig(require_dividend=True))
    SetupHunterAgent().run(make_ctx(StubProvider(fundamentals=no_dividend), strict))
    setup = bus.latest(TOPIC_SETUP)
    assert setup.passed_screen is False
    assert "pays no dividend" in setup.screen_reasons


def test_setup_is_skipped_when_history_is_too_short(make_ctx, bus):
    provider = StubProvider(
        fundamentals={"X": make_fundamentals("X")}, bars={"X": make_bars(n=100)}
    )
    SetupHunterAgent().run(make_ctx(provider))
    assert bus.read(TOPIC_SETUP) == []


def test_stop_sits_below_entry_and_target_above(make_ctx, bus):
    provider = StubProvider(fundamentals={"X": make_fundamentals("X")})
    SetupHunterAgent().run(make_ctx(provider))
    s = bus.latest(TOPIC_SETUP)
    assert s.stop < s.entry < s.target
    assert s.reward_risk > 0


def test_stop_is_clamped_into_its_atr_band(make_ctx, bus):
    provider = StubProvider(fundamentals={"X": make_fundamentals("X")})
    SetupHunterAgent().run(make_ctx(provider))
    s = bus.latest(TOPIC_SETUP)
    distance_in_atr = (s.entry - s.stop) / s.atr
    assert 1.0 <= distance_in_atr <= 3.0 + 1e-6


def test_reward_risk_is_zero_when_the_stop_is_not_below_entry():
    broken = Setup(ticker="X", passed_screen=True, screen_reasons=[], entry=10.0,
                   stop=10.0, target=15.0, atr=1.0, technical_score=0.5,
                   momentum_63d=0.0, drawdown_from_52w_high=0.0, rsi_14=50.0)
    assert broken.reward_risk == 0.0


# ---------------------------------------------------------------- agent three

def test_sentiment_is_neutral_with_no_headlines(make_ctx, bus):
    provider = StubProvider(fundamentals={"X": make_fundamentals("X")})
    NewsSentimentAgent().run(make_ctx(provider))
    read = bus.latest(TOPIC_SENTIMENT)
    assert read.score == 0.0
    assert read.article_count == 0


def test_bullish_and_bearish_headlines_move_the_score(make_ctx, bus, headline):
    good = StubProvider(
        fundamentals={"X": make_fundamentals("X")},
        headlines={"X": [headline(title="Company raises guidance and beats estimates")]},
    )
    NewsSentimentAgent().run(make_ctx(good))
    assert bus.latest(TOPIC_SENTIMENT).score > 0.4

    bus.clear()
    bad = StubProvider(
        fundamentals={"X": make_fundamentals("X")},
        headlines={"X": [headline(title="Company misses badly, guidance cut on weak demand")]},
    )
    NewsSentimentAgent().run(make_ctx(bad))
    assert bus.latest(TOPIC_SENTIMENT).score < -0.4


@pytest.mark.parametrize("title,label", [
    ("Auditor flags going concern doubt", "going-concern warning"),
    ("Regulator opens investigation into filings", "regulatory investigation"),
    ("Board cuts dividend to preserve cash", "dividend cut"),
    ("Short seller alleges fraud at the company", "fraud allegation"),
    ("Company announces dilutive equity offering", "dilutive equity offering"),
])
def test_landmines_are_detected(make_ctx, bus, headline, title, label):
    provider = StubProvider(
        fundamentals={"X": make_fundamentals("X")},
        headlines={"X": [headline(title=title)]},
    )
    NewsSentimentAgent().run(make_ctx(provider))
    read = bus.latest(TOPIC_SENTIMENT)
    assert read.has_landmine
    assert label in read.landmines


def test_stale_news_counts_for_less_than_fresh_news(make_ctx, bus, headline):
    title = "Company raises guidance"
    fresh = StubProvider(fundamentals={"X": make_fundamentals("X")},
                         headlines={"X": [headline(title=title, date="2026-08-28")]})
    stale = StubProvider(fundamentals={"X": make_fundamentals("X")},
                         headlines={"X": [headline(title=title, date="2025-01-01")]})
    NewsSentimentAgent().run(make_ctx(fresh))
    fresh_read = bus.latest(TOPIC_SENTIMENT)
    bus.clear()
    NewsSentimentAgent().run(make_ctx(stale))
    stale_read = bus.latest(TOPIC_SENTIMENT)
    # Both are positive, but the weighted average is diluted less when fresh.
    assert fresh_read.score >= stale_read.score


def test_a_press_release_carries_less_weight_than_a_wire(make_ctx, bus, headline):
    agent = NewsSentimentAgent()
    assert agent._source("Reuters") > agent._source("PRNewswire")
    assert agent._source("Unknown Blog") == pytest.approx(0.6)


# ----------------------------------------------------------------- agent four

def _run_risk(make_ctx, bus, fundamentals, headlines=None, config=None):
    provider = StubProvider(
        fundamentals={fundamentals.ticker: fundamentals},
        headlines={fundamentals.ticker: headlines or []},
    )
    ctx = make_ctx(provider, config)
    MarketWatchAgent().run(ctx)
    SetupHunterAgent().run(ctx)
    NewsSentimentAgent().run(ctx)
    RiskManagerAgent().run(ctx)
    return bus.latest(TOPIC_RISK)


def test_a_name_failing_the_screen_is_vetoed(make_ctx, bus):
    decision = _run_risk(make_ctx, bus, make_fundamentals("X", pe_trailing=8.0))
    assert decision.verdict is Verdict.PASS
    assert any("failed the screen" in v for v in decision.vetoes)


def test_a_news_landmine_vetoes_regardless_of_the_chart(make_ctx, bus, headline):
    decision = _run_risk(
        make_ctx, bus, make_fundamentals("X"),
        headlines=[headline(title="SEC investigation opened into the company")],
    )
    assert decision.verdict is Verdict.PASS
    assert any("landmine" in v for v in decision.vetoes)


def test_an_uncovered_dividend_is_vetoed(make_ctx, bus):
    decision = _run_risk(make_ctx, bus,
                         make_fundamentals("X", dividend_yield=0.12, payout_ratio=1.9))
    assert decision.verdict is Verdict.PASS
    assert any("payout ratio" in v for v in decision.vetoes)


def test_an_illiquid_name_is_vetoed_relative_to_position_size(make_ctx, bus):
    big_account = DeskConfig(risk=RiskConfig(account_equity=50_000_000.0))
    decision = _run_risk(make_ctx, bus, make_fundamentals("X"), config=big_account)
    assert decision.verdict is Verdict.PASS
    assert any("daily volume" in v for v in decision.vetoes)


def test_a_vetoed_name_is_never_given_a_size(make_ctx, bus):
    decision = _run_risk(make_ctx, bus, make_fundamentals("X", pe_trailing=8.0))
    assert decision.shares == 0
    assert decision.position_dollars == 0.0
    assert decision.risk_dollars == 0.0
    assert decision.expected_log_growth == 0.0


def test_a_clean_name_is_sized_within_every_cap(make_ctx, bus):
    cfg = DeskConfig()
    decision = _run_risk(make_ctx, bus, make_fundamentals("X"), config=cfg)
    if decision.verdict is Verdict.TAKE:
        assert decision.shares > 0
        assert decision.applied_fraction <= cfg.risk.max_risk_per_trade + 1e-9
        assert decision.position_dollars <= (
            cfg.risk.max_position_weight * cfg.risk.account_equity + 1e-6
        )
        assert decision.risk_dollars <= (
            cfg.risk.max_risk_per_trade * cfg.risk.account_equity + 1e-6
        )
