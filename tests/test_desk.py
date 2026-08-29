"""End-to-end desk runs against the bundled snapshot.

These assert the invariants a desk must never violate, whatever the data says.
"""

import pytest

from stock_deal_desk import DealDesk, DeskConfig, RiskConfig, ScreenConfig
from stock_deal_desk.models import Verdict
from stock_deal_desk.providers import get_provider
from stock_deal_desk.report import render, render_markdown


@pytest.fixture(scope="module")
def run():
    return DealDesk(provider="fixture").run()


def test_every_agent_reported(run):
    assert len(run.agent_log) == 4
    assert run.universe_size > 0
    assert len(run.recommendations) > 0


def test_the_run_is_deterministic():
    a = DealDesk(provider="fixture").run()
    b = DealDesk(provider="fixture").run()
    assert [(r.ticker, r.verdict, r.risk.shares) for r in a.recommendations] == \
           [(r.ticker, r.verdict, r.risk.shares) for r in b.recommendations]


def test_portfolio_heat_stays_inside_the_budget(run):
    assert run.portfolio_heat <= run.config.risk.max_portfolio_heat + 1e-9


def test_position_count_and_sector_limits_hold(run):
    cfg = run.config.risk
    assert len(run.takes) <= cfg.max_positions
    per_sector = {}
    for r in run.takes:
        per_sector[r.sector] = per_sector.get(r.sector, 0) + 1
    assert all(count <= cfg.max_names_per_sector for count in per_sector.values())


def test_no_take_exceeds_the_single_name_notional_cap(run):
    cap = run.config.risk.max_position_weight * run.config.risk.account_equity
    for r in run.takes:
        assert r.risk.position_dollars <= cap + 1e-6


def test_every_take_is_a_real_tradeable_position(run):
    for r in run.takes:
        assert r.risk.shares > 0
        assert r.setup.stop < r.setup.entry < r.setup.target
        assert r.risk.expected_log_growth > 0


def test_nothing_the_desk_takes_carries_a_news_landmine(run):
    assert all(not r.sentiment.has_landmine for r in run.takes)


def test_nothing_the_desk_takes_failed_the_screen(run):
    assert all(r.setup.passed_screen for r in run.takes)


def test_no_take_has_an_uncovered_dividend(run):
    cap = run.config.risk.max_payout_ratio
    for r in run.takes:
        f = r.fundamentals
        if f.pays_dividend and f.payout_ratio is not None:
            assert f.payout_ratio <= cap


def test_every_take_clears_the_minimum_reward_to_risk(run):
    for r in run.takes:
        assert r.setup.reward_risk >= run.config.risk.min_reward_risk


def test_rejected_names_are_never_sized(run):
    for r in run.recommendations:
        if r.verdict is not Verdict.TAKE:
            assert r.risk.shares == 0
            assert r.risk.position_dollars == 0.0


def test_every_rejection_carries_a_reason(run):
    for r in run.recommendations:
        if r.verdict is not Verdict.TAKE:
            assert r.risk.vetoes, f"{r.ticker} was rejected with no explanation"


def test_a_smaller_account_takes_smaller_positions():
    small = DealDesk(provider="fixture",
                     config=DeskConfig(risk=RiskConfig(account_equity=10_000.0))).run()
    big = DealDesk(provider="fixture").run()
    assert small.deployed_dollars < big.deployed_dollars


def test_a_stricter_screen_admits_fewer_names():
    strict = DealDesk(provider="fixture", config=DeskConfig(
        screen=ScreenConfig(pe_min=30.0, price_max=15.0,
                            require_dividend=True, min_dividend_yield=0.04))).run()
    assert strict.screened_in < DealDesk(provider="fixture").run().screened_in


def test_requiring_a_dividend_excludes_names_that_pay_nothing():
    strict = DealDesk(provider="fixture", config=DeskConfig(
        screen=ScreenConfig(require_dividend=True))).run()
    assert all(r.fundamentals.pays_dividend for r in strict.takes)


def test_a_zero_kelly_haircut_deploys_no_capital():
    flat = DealDesk(provider="fixture",
                    config=DeskConfig(risk=RiskConfig(kelly_haircut=0.0))).run()
    assert flat.takes == []
    assert flat.deployed_dollars == 0.0


def test_expected_growth_is_the_sum_of_position_contributions(run):
    assert run.expected_log_growth == pytest.approx(
        sum(r.risk.expected_log_growth for r in run.takes)
    )


def test_the_fixture_provider_is_flagged_as_not_live(run):
    assert run.provider_is_live is False
    assert "SYNTHETIC" in render(run)
    assert "Synthetic data" in render_markdown(run)


def test_reports_render_without_error(run):
    assert "STOCK DEAL DESK" in render(run, show_passes=True)
    assert "| Ticker |" in render_markdown(run)


def test_an_unknown_provider_name_is_rejected():
    with pytest.raises(ValueError, match="unknown provider"):
        get_provider("bloomberg-terminal")


def test_a_missing_snapshot_fails_loudly():
    with pytest.raises(FileNotFoundError):
        get_provider("fixture", path="/nonexistent/snapshot.json")
