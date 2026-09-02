"""Technical indicator math, stdlib only so the core has no hard dependencies."""

from __future__ import annotations

import math
from typing import Sequence

from .models import Bar

TRADING_DAYS = 252


def closes(bars: Sequence[Bar]) -> list[float]:
    return [b.close for b in bars]


def sma(values: Sequence[float], window: int) -> float | None:
    if window <= 0 or len(values) < window:
        return None
    return sum(values[-window:]) / window


def ema(values: Sequence[float], window: int) -> float | None:
    if window <= 0 or len(values) < window:
        return None
    k = 2.0 / (window + 1.0)
    out = sum(values[:window]) / window
    for v in values[window:]:
        out = v * k + out * (1.0 - k)
    return out


def rsi(values: Sequence[float], window: int = 14) -> float | None:
    """Wilder's RSI. Returns None when there is not enough history."""
    if len(values) < window + 1:
        return None
    gains, losses = [], []
    for prev, cur in zip(values[-(window + 1):-1], values[-window:]):
        change = cur - prev
        gains.append(max(change, 0.0))
        losses.append(max(-change, 0.0))
    avg_gain = sum(gains) / window
    avg_loss = sum(losses) / window
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def atr(bars: Sequence[Bar], window: int = 14) -> float | None:
    """Average true range -- the volatility unit stops are placed in."""
    if len(bars) < window + 1:
        return None
    true_ranges = []
    for prev, cur in zip(bars[-(window + 1):-1], bars[-window:]):
        true_ranges.append(max(
            cur.high - cur.low,
            abs(cur.high - prev.close),
            abs(cur.low - prev.close),
        ))
    return sum(true_ranges) / window


def daily_returns(values: Sequence[float]) -> list[float]:
    out = []
    for prev, cur in zip(values[:-1], values[1:]):
        if prev > 0:
            out.append(cur / prev - 1.0)
    return out


def realized_vol(values: Sequence[float], window: int = 63) -> float | None:
    """Annualised standard deviation of daily returns."""
    rets = daily_returns(values[-(window + 1):])
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(TRADING_DAYS)


def momentum(values: Sequence[float], window: int) -> float | None:
    """Total return over ``window`` bars, as a decimal."""
    if len(values) < window + 1 or values[-(window + 1)] <= 0:
        return None
    return values[-1] / values[-(window + 1)] - 1.0


def max_drawdown(values: Sequence[float]) -> float:
    """Worst peak-to-trough decline in the series, as a positive decimal."""
    peak = float("-inf")
    worst = 0.0
    for v in values:
        peak = max(peak, v)
        if peak > 0:
            worst = max(worst, (peak - v) / peak)
    return worst


def drawdown_from_high(values: Sequence[float], window: int = TRADING_DAYS) -> float:
    """How far below its ``window``-bar high the last price sits."""
    recent = values[-window:]
    if not recent:
        return 0.0
    high = max(recent)
    if high <= 0:
        return 0.0
    return (high - recent[-1]) / high


def position_in_range(values: Sequence[float], window: int = TRADING_DAYS) -> float:
    """0.0 == at the window low, 1.0 == at the window high."""
    recent = values[-window:]
    if not recent:
        return 0.5
    low, high = min(recent), max(recent)
    if high <= low:
        return 0.5
    return (recent[-1] - low) / (high - low)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))
