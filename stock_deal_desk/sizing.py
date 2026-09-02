"""Growth-optimal position sizing.

The brief was "maximise capital growth". That phrase has a precise answer:
maximising the *expected logarithm* of wealth maximises the long-run compound
growth rate of the account, and the fraction that does it is the Kelly
fraction. Sizing bigger than Kelly lowers growth *and* raises risk -- it is
dominated in both directions, which is why the risk agent treats Kelly as a
ceiling rather than a target, and trades a fraction of it.
"""

from __future__ import annotations

import math


def kelly_fraction(win_probability: float, reward_risk: float) -> float:
    """Fraction of equity to put at risk on one binary bet.

    ``reward_risk`` is the payoff ratio b: a win returns b times the amount
    risked, a loss forfeits the amount risked. Kelly is then::

        f* = p - (1 - p) / b

    Negative output means the bet has no edge and should not be taken.
    """
    if reward_risk <= 0:
        return 0.0
    p = max(0.0, min(1.0, win_probability))
    return p - (1.0 - p) / reward_risk


def expected_log_growth(fraction: float, win_probability: float, reward_risk: float) -> float:
    """E[ln(1 + r)] per trade at a given risk fraction.

    This is the quantity Kelly maximises, and it is what the desk ranks on:
    a name with a lower headline score but a fatter growth contribution is the
    better use of capital.
    """
    if fraction <= 0 or reward_risk <= 0:
        return 0.0
    if fraction >= 1.0:
        return float("-inf")   # a full loss wipes the account; ln(0) is -inf
    p = max(0.0, min(1.0, win_probability))
    return p * math.log(1.0 + fraction * reward_risk) + (1.0 - p) * math.log(1.0 - fraction)


def shares_for_risk(risk_dollars: float, entry: float, stop: float) -> int:
    """How many shares put exactly ``risk_dollars`` at risk to the stop."""
    per_share_risk = entry - stop
    if per_share_risk <= 0 or risk_dollars <= 0:
        return 0
    return int(risk_dollars // per_share_risk)


def implied_win_probability(technical_score: float, sentiment: float, regime_multiplier: float) -> float:
    """Blend the agents' scores into a calibrated-ish hit rate.

    Deliberately conservative and tightly bounded: an un-backtested score is
    not a probability, and Kelly is famously sensitive to overestimating p.
    The band is 0.30..0.62 so no single trade can ever look like a sure thing.
    """
    base = 0.30 + 0.24 * max(0.0, min(1.0, technical_score))
    base += 0.06 * max(-1.0, min(1.0, sentiment))
    base *= 0.85 + 0.15 * max(0.0, min(1.0, regime_multiplier))
    return max(0.30, min(0.62, base))
