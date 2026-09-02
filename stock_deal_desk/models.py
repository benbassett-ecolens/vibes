"""Core value objects passed between desk agents.

Everything here is a frozen dataclass so agents can publish results onto the
bus without any risk of a downstream agent mutating an upstream agent's view.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Regime(str, Enum):
    """Top-down market state, decided by the market-watch agent."""

    RISK_ON = "risk_on"
    NEUTRAL = "neutral"
    RISK_OFF = "risk_off"

    @property
    def budget_multiplier(self) -> float:
        """How much of the normal risk budget the desk is allowed to deploy."""
        return {"risk_on": 1.0, "neutral": 0.6, "risk_off": 0.25}[self.value]


class Verdict(str, Enum):
    TAKE = "take"
    WATCH = "watch"
    PASS = "pass"


@dataclass(frozen=True)
class Bar:
    """One daily OHLCV bar."""

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Fundamentals:
    """The valuation / payout facts the screen is defined over."""

    ticker: str
    name: str
    sector: str
    price: float
    pe_trailing: Optional[float]
    pe_forward: Optional[float]
    eps_trailing: Optional[float]
    dividend_yield: float           # decimal, e.g. 0.031 == 3.1%
    payout_ratio: Optional[float]   # decimal; >1.0 means dividend exceeds earnings
    market_cap: float
    shares_out: float
    avg_dollar_volume: float

    @property
    def pays_dividend(self) -> bool:
        return self.dividend_yield > 0.0


@dataclass(frozen=True)
class Headline:
    """A single news item handed to the sentiment agent."""

    ticker: str
    date: str
    source: str
    title: str


@dataclass(frozen=True)
class MarketView:
    """Published by MarketWatchAgent — the desk's top-down context."""

    regime: Regime
    index_trend: float          # % above/below the 200d average
    realized_vol: float         # annualised, decimal
    breadth: float              # fraction of universe above its own 50d average
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Setup:
    """Published by SetupHunterAgent — a screened, technically-scored candidate."""

    ticker: str
    passed_screen: bool
    screen_reasons: list[str]
    entry: float
    stop: float
    target: float
    atr: float
    technical_score: float      # 0..1
    momentum_63d: float
    drawdown_from_52w_high: float
    rsi_14: float
    notes: list[str] = field(default_factory=list)

    @property
    def reward_risk(self) -> float:
        risk = self.entry - self.stop
        if risk <= 0:
            return 0.0
        return (self.target - self.entry) / risk


@dataclass(frozen=True)
class SentimentRead:
    """Published by NewsSentimentAgent."""

    ticker: str
    score: float                # -1..+1
    article_count: int
    catalysts: list[str] = field(default_factory=list)
    landmines: list[str] = field(default_factory=list)

    @property
    def has_landmine(self) -> bool:
        return bool(self.landmines)


@dataclass(frozen=True)
class RiskDecision:
    """Published by RiskManagerAgent — the only agent allowed to say 'size'."""

    ticker: str
    verdict: Verdict
    vetoes: list[str]          # blocking reasons, plus any sizing notes worth reading
    kelly_fraction: float       # raw growth-optimal fraction of equity to risk
    applied_fraction: float     # after fractional-Kelly haircut, regime and caps
    risk_dollars: float
    shares: int
    position_dollars: float
    expected_log_growth: float  # per-trade E[ln(1+r)], the thing being maximised
    win_probability: float


@dataclass(frozen=True)
class Recommendation:
    """The desk's final, merged output for one name."""

    ticker: str
    name: str
    sector: str
    composite_score: float
    fundamentals: Fundamentals
    setup: Setup
    sentiment: SentimentRead
    risk: RiskDecision

    @property
    def verdict(self) -> Verdict:
        return self.risk.verdict
