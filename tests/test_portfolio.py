"""Book-level constraints: heat, sector concentration, position count."""

from stock_deal_desk.agents import RiskManagerAgent
from stock_deal_desk.config import RiskConfig
from stock_deal_desk.models import RiskDecision, Verdict

apply_constraints = RiskManagerAgent.apply_portfolio_constraints


def decision(ticker, fraction=0.01, shares=100, verdict=Verdict.TAKE):
    return RiskDecision(
        ticker=ticker, verdict=verdict, vetoes=[], kelly_fraction=0.2,
        applied_fraction=fraction, risk_dollars=fraction * 100_000, shares=shares,
        position_dollars=shares * 10.0, expected_log_growth=0.005, win_probability=0.5,
    )


def test_position_count_is_capped_and_the_best_names_win():
    cfg = RiskConfig(max_positions=2, max_portfolio_heat=1.0, max_names_per_sector=99)
    ranked = [decision(t) for t in ("A", "B", "C", "D")]
    out = {d.ticker: d for d in apply_constraints(ranked, {}, cfg)}
    assert [d.verdict for d in out.values()].count(Verdict.TAKE) == 2
    assert out["A"].verdict is Verdict.TAKE and out["B"].verdict is Verdict.TAKE
    assert out["C"].verdict is Verdict.WATCH
    assert any("2-position maximum" in v for v in out["C"].vetoes)


def test_sector_concentration_is_capped():
    cfg = RiskConfig(max_names_per_sector=2, max_positions=99, max_portfolio_heat=1.0)
    sectors = {t: "Financial Services" for t in ("A", "B", "C")}
    sectors["D"] = "Energy"
    out = {d.ticker: d for d in apply_constraints([decision(t) for t in "ABCD"], sectors, cfg)}
    assert out["A"].verdict is Verdict.TAKE
    assert out["B"].verdict is Verdict.TAKE
    assert out["C"].verdict is Verdict.WATCH
    assert any("correlation limit" in v for v in out["C"].vetoes)
    assert out["D"].verdict is Verdict.TAKE   # different sector, still allowed


def test_total_heat_never_exceeds_the_budget():
    cfg = RiskConfig(max_portfolio_heat=0.05, max_positions=99, max_names_per_sector=99)
    out = apply_constraints([decision(t, fraction=0.02) for t in "ABCDEF"], {}, cfg)
    heat = sum(d.applied_fraction for d in out if d.verdict is Verdict.TAKE)
    assert heat <= cfg.max_portfolio_heat + 1e-9


def test_a_partial_fit_is_trimmed_rather_than_dropped():
    cfg = RiskConfig(max_portfolio_heat=0.03, max_positions=99, max_names_per_sector=99)
    out = {d.ticker: d for d in apply_constraints(
        [decision("A", fraction=0.02), decision("B", fraction=0.02)], {}, cfg)}
    assert out["B"].verdict is Verdict.TAKE
    assert out["B"].applied_fraction < 0.02
    assert out["B"].shares < 100
    assert any("trimmed to fit" in v for v in out["B"].vetoes)


def test_trimming_scales_risk_and_notional_together():
    cfg = RiskConfig(max_portfolio_heat=0.03, max_positions=99, max_names_per_sector=99)
    out = {d.ticker: d for d in apply_constraints(
        [decision("A", fraction=0.02), decision("B", fraction=0.02, shares=100)], {}, cfg)}
    trimmed = out["B"]
    assert trimmed.position_dollars < 1000.0
    assert trimmed.risk_dollars < 0.02 * 100_000


def test_non_take_decisions_pass_through_untouched():
    cfg = RiskConfig(max_positions=1, max_portfolio_heat=1.0)
    watched = decision("A", verdict=Verdict.WATCH, shares=0)
    out = apply_constraints([watched], {}, cfg)
    assert out[0] is watched


def test_an_exhausted_heat_budget_demotes_rather_than_trims():
    cfg = RiskConfig(max_portfolio_heat=0.02, max_positions=99, max_names_per_sector=99)
    out = {d.ticker: d for d in apply_constraints(
        [decision("A", fraction=0.02), decision("B", fraction=0.02)], {}, cfg)}
    assert out["B"].verdict is Verdict.WATCH
    assert out["B"].shares == 0
    assert any("fully allocated" in v for v in out["B"].vetoes)
