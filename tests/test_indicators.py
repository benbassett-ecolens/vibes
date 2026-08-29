"""Indicator math, checked against values worked out by hand."""

import math

import pytest

from stock_deal_desk.indicators import (
    atr, drawdown_from_high, max_drawdown, momentum, position_in_range,
    realized_vol, rsi, sma,
)
from stock_deal_desk.models import Bar


def bar(close, high=None, low=None):
    return Bar(date="2026-01-01", open=close, high=high or close * 1.01,
               low=low or close * 0.99, close=close, volume=1000.0)


def test_sma_needs_a_full_window():
    assert sma([1, 2, 3], 4) is None
    assert sma([1, 2, 3, 4], 4) == 2.5


def test_rsi_all_gains_is_pinned_high():
    assert rsi(list(range(1, 40)), 14) == 100.0


def test_rsi_all_losses_is_pinned_low():
    assert rsi(list(range(40, 1, -1)), 14) == pytest.approx(0.0, abs=1e-9)


def test_rsi_flat_series_is_neutral():
    assert rsi([10.0] * 30, 14) == 50.0


def test_rsi_needs_window_plus_one():
    assert rsi([1.0] * 14, 14) is None
    assert rsi([1.0] * 15, 14) is not None


def test_atr_of_constant_range_bars():
    bars = [bar(10.0, high=10.5, low=9.5) for _ in range(20)]
    assert atr(bars, 14) == pytest.approx(1.0)


def test_momentum_is_total_return():
    assert momentum([100.0] + [0.0] * 4 + [110.0], 5) == pytest.approx(0.10)


def test_max_drawdown_finds_the_worst_trough_not_the_last():
    # 100 -> 50 is a 50% drawdown; the later 120 -> 96 is only 20%.
    assert max_drawdown([100, 50, 120, 96]) == pytest.approx(0.50)


def test_drawdown_from_high_uses_the_window_high():
    assert drawdown_from_high([100, 200, 150], 3) == pytest.approx(0.25)


def test_position_in_range_endpoints():
    assert position_in_range([10, 20, 30], 3) == pytest.approx(1.0)
    assert position_in_range([30, 20, 10], 3) == pytest.approx(0.0)
    assert position_in_range([10, 30, 20], 3) == pytest.approx(0.5)


def test_position_in_range_of_flat_series_is_midpoint():
    assert position_in_range([5.0] * 10, 10) == 0.5


def test_realized_vol_annualises_daily_moves():
    # A series alternating +1%/-1% has a known daily sigma; check the sqrt(252).
    px = [100.0]
    for i in range(64):
        px.append(px[-1] * (1.01 if i % 2 == 0 else 1 / 1.01))
    vol = realized_vol(px, 63)
    assert vol is not None
    assert vol == pytest.approx(0.01 * math.sqrt(252), rel=0.10)
