"""Kelly sizing -- the growth-optimal core of the risk agent."""

import math

import pytest

from stock_deal_desk.sizing import (
    expected_log_growth, implied_win_probability, kelly_fraction, shares_for_risk,
)


def test_kelly_matches_the_textbook_coin_flip():
    # p=0.6 on an even-money bet: f* = 2p - 1 = 0.20
    assert kelly_fraction(0.6, 1.0) == pytest.approx(0.20)


def test_kelly_is_negative_without_an_edge():
    assert kelly_fraction(0.40, 1.0) < 0
    assert kelly_fraction(0.30, 2.0) < 0


def test_kelly_is_zero_at_break_even():
    # p = 1/(1+b) is exactly break-even.
    assert kelly_fraction(1 / 3, 2.0) == pytest.approx(0.0, abs=1e-12)


def test_kelly_rejects_non_positive_payoff():
    assert kelly_fraction(0.9, 0.0) == 0.0
    assert kelly_fraction(0.9, -1.0) == 0.0


def test_kelly_fraction_actually_maximises_log_growth():
    """The whole justification for the module, verified numerically."""
    p, b = 0.55, 2.0
    optimum = kelly_fraction(p, b)
    best = max(
        (f / 1000.0 for f in range(1, 1000)),
        key=lambda f: expected_log_growth(f, p, b),
    )
    assert best == pytest.approx(optimum, abs=0.002)


def test_overbetting_kelly_lowers_growth():
    p, b = 0.55, 2.0
    f = kelly_fraction(p, b)
    assert expected_log_growth(f * 2, p, b) < expected_log_growth(f, p, b)


def test_betting_everything_is_ruin():
    assert expected_log_growth(1.0, 0.9, 5.0) == -math.inf


def test_expected_log_growth_is_zero_for_no_position():
    assert expected_log_growth(0.0, 0.6, 2.0) == 0.0


def test_shares_for_risk_rounds_down_and_never_overspends():
    # $2000 risk, $1.50 of risk per share -> 1333 shares, risking $1999.50
    shares = shares_for_risk(2000.0, 10.0, 8.5)
    assert shares == 1333
    assert shares * 1.5 <= 2000.0


def test_shares_for_risk_refuses_an_inverted_stop():
    assert shares_for_risk(2000.0, 10.0, 10.0) == 0
    assert shares_for_risk(2000.0, 10.0, 12.0) == 0


def test_implied_win_probability_stays_inside_its_band():
    for tech in (0.0, 0.5, 1.0):
        for sent in (-1.0, 0.0, 1.0):
            for regime in (0.25, 0.6, 1.0):
                p = implied_win_probability(tech, sent, regime)
                assert 0.30 <= p <= 0.62


def test_implied_win_probability_rises_with_conviction():
    assert implied_win_probability(0.9, 0.5, 1.0) > implied_win_probability(0.2, 0.5, 1.0)
    assert implied_win_probability(0.5, 0.9, 1.0) > implied_win_probability(0.5, -0.9, 1.0)
