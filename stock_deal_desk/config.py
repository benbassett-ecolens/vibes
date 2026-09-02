"""Desk configuration: the screen, the risk policy, and the merge weights.

The defaults encode the brief this desk was built for: *high* P/E, *low*
absolute share price, dividend preferred. That is a deliberately unusual
combination -- see README.md ("Why this screen is strange, and what it
actually selects for") for what it really selects and how to invert it.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ScreenConfig:
    """The hard filter applied by the setup-hunter agent."""

    pe_min: float = 25.0            # "high P/E" floor
    pe_max: float = 150.0           # above this, earnings are noise not signal
    price_max: float = 25.0         # "low ticker price" ceiling
    price_min: float = 3.00         # below this: sub-penny spreads, delisting risk
    require_dividend: bool = False  # user said "would be great", not "must"
    min_dividend_yield: float = 0.0
    min_avg_dollar_volume: float = 2_000_000.0   # tradeable without moving it
    min_market_cap: float = 300_000_000.0


@dataclass(frozen=True)
class RiskConfig:
    """The risk manager's policy. This agent has veto power over every name."""

    account_equity: float = 100_000.0
    kelly_haircut: float = 0.5      # half-Kelly: full Kelly is unlivable in practice
    max_risk_per_trade: float = 0.02        # 2% of equity at risk, hard cap
    max_position_weight: float = 0.10       # no name over 10% of the book
    max_portfolio_heat: float = 0.06        # 6% total equity at risk across all open names
    max_names_per_sector: int = 2
    max_positions: int = 8
    max_payout_ratio: float = 1.20  # dividend funded far beyond earnings -> cut risk
    min_reward_risk: float = 1.8
    veto_on_landmine: bool = True


@dataclass(frozen=True)
class MergeWeights:
    """How the desk blends the three analytical agents into one score."""

    technical: float = 0.45
    sentiment: float = 0.25
    quality: float = 0.30           # dividend support + payout safety + liquidity

    def normalised(self) -> "MergeWeights":
        total = self.technical + self.sentiment + self.quality
        if total <= 0:
            raise ValueError("merge weights must sum to a positive number")
        return MergeWeights(
            technical=self.technical / total,
            sentiment=self.sentiment / total,
            quality=self.quality / total,
        )


@dataclass(frozen=True)
class DeskConfig:
    screen: ScreenConfig = field(default_factory=ScreenConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    weights: MergeWeights = field(default_factory=MergeWeights)
    benchmark: str = "SPY"
