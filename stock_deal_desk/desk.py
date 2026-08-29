"""The deal desk: runs the swarm and merges its findings into recommendations.

Execution order is set by data dependency, not by preference. The market-watch,
setup-hunter and news-sentiment agents are independent of each other, so they
run concurrently. The risk manager consumes all three from the bus, so it runs
last -- and then gets a second, portfolio-level pass once the desk has ranked
the survivors.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .agents import (
    AgentContext, MarketWatchAgent, NewsSentimentAgent, RiskManagerAgent, SetupHunterAgent,
)
from .bus import TOPIC_MARKET, TOPIC_RISK, TOPIC_SENTIMENT, TOPIC_SETUP, MessageBus
from .config import DeskConfig
from .indicators import clamp
from .models import Fundamentals, MarketView, Recommendation, Regime, Verdict
from .providers import DataProvider, get_provider

VERDICT_RANK = {Verdict.TAKE: 0, Verdict.WATCH: 1, Verdict.PASS: 2}


@dataclass
class DeskRun:
    """Everything one desk session produced."""

    market: MarketView
    recommendations: list[Recommendation]
    universe_size: int
    screened_in: int
    provider_name: str
    provider_is_live: bool
    config: DeskConfig
    agent_log: list[str] = field(default_factory=list)

    @property
    def takes(self) -> list[Recommendation]:
        return [r for r in self.recommendations if r.verdict is Verdict.TAKE]

    @property
    def watches(self) -> list[Recommendation]:
        return [r for r in self.recommendations if r.verdict is Verdict.WATCH]

    @property
    def deployed_dollars(self) -> float:
        return sum(r.risk.position_dollars for r in self.takes)

    @property
    def portfolio_heat(self) -> float:
        return sum(r.risk.applied_fraction for r in self.takes)

    @property
    def expected_log_growth(self) -> float:
        """Additive across independent positions -- log wealth is additive."""
        return sum(r.risk.expected_log_growth for r in self.takes)


class DealDesk:
    def __init__(self, provider: DataProvider | str = "fixture",
                 config: DeskConfig | None = None) -> None:
        self.provider = get_provider(provider) if isinstance(provider, str) else provider
        self.config = config or DeskConfig()
        self.bus = MessageBus()

    def run(self) -> DeskRun:
        ctx = AgentContext(provider=self.provider, config=self.config, bus=self.bus)
        log: list[str] = []

        # Wave 1: independent agents, run concurrently.
        wave_one = [MarketWatchAgent(), SetupHunterAgent(), NewsSentimentAgent()]
        with ThreadPoolExecutor(max_workers=len(wave_one)) as pool:
            futures = {pool.submit(agent.run, ctx): agent for agent in wave_one}
            for future in futures:
                future.result()   # re-raise inside the caller, don't swallow
        for agent in wave_one:
            log.append(f"{agent.name}: published {len(self.bus.read(agent.topic))} message(s)")

        # Wave 2: the risk manager, which needs all three.
        risk_agent = RiskManagerAgent()
        risk_agent.run(ctx)
        log.append(f"{risk_agent.name}: published {len(self.bus.read(risk_agent.topic))} decision(s)")

        market: MarketView = self.bus.latest(TOPIC_MARKET) or MarketView(
            regime=Regime.NEUTRAL, index_trend=0.0, realized_vol=0.0, breadth=0.5,
        )
        return self._merge(ctx, market, log)

    # ------------------------------------------------------------------ merge

    def _merge(self, ctx: AgentContext, market: MarketView, log: list[str]) -> DeskRun:
        setups = self.bus.by_ticker(TOPIC_SETUP)
        sentiments = self.bus.by_ticker(TOPIC_SENTIMENT)
        decisions = self.bus.by_ticker(TOPIC_RISK)

        fundamentals: dict[str, Fundamentals] = {}
        for ticker in setups:
            found = self.provider.fundamentals(ticker)
            if found is not None:
                fundamentals[ticker] = found

        scored: list[tuple[float, str]] = []
        for ticker, setup in setups.items():
            f = fundamentals.get(ticker)
            if f is None or ticker not in decisions:
                continue
            sentiment = sentiments.get(ticker)
            scored.append((self._composite(setup, f, sentiment), ticker))

        # Rank before the portfolio pass: scarce limits go to the best names
        # first. Conviction is the primary key and growth contribution the
        # tiebreak -- ranking on post-cap growth alone degenerates into
        # "whichever name the notional cap happens to bind least", which is a
        # statement about share price, not about edge.
        scored.sort(key=lambda item: (
            VERDICT_RANK[decisions[item[1]].verdict],
            -item[0],
            -decisions[item[1]].expected_log_growth,
        ))

        ordered_decisions = [decisions[ticker] for _, ticker in scored]
        sectors = {t: f.sector for t, f in fundamentals.items()}
        final = RiskManagerAgent.apply_portfolio_constraints(
            ordered_decisions, sectors, self.config.risk
        )
        by_ticker = {d.ticker: d for d in final}

        recommendations = [
            Recommendation(
                ticker=ticker,
                name=fundamentals[ticker].name,
                sector=fundamentals[ticker].sector,
                composite_score=round(score, 4),
                fundamentals=fundamentals[ticker],
                setup=setups[ticker],
                sentiment=sentiments.get(ticker) or _empty_sentiment(ticker),
                risk=by_ticker[ticker],
            )
            for score, ticker in scored
        ]
        # Re-sort for display: the portfolio pass may have demoted names.
        recommendations.sort(key=lambda r: (
            VERDICT_RANK[r.verdict], -r.composite_score, -r.risk.expected_log_growth
        ))

        return DeskRun(
            market=market,
            recommendations=recommendations,
            universe_size=len(self.provider.universe()),
            screened_in=sum(1 for s in setups.values() if s.passed_screen),
            provider_name=self.provider.name,
            provider_is_live=self.provider.is_live(),
            config=self.config,
            agent_log=log,
        )

    def _composite(self, setup, f: Fundamentals, sentiment) -> float:
        w = self.config.weights.normalised()
        # Map sentiment from -1..+1 onto 0..1; no news is a neutral 0.5.
        sentiment_score = (sentiment.score + 1.0) / 2.0 if sentiment else 0.5
        return (
            w.technical * setup.technical_score
            + w.sentiment * clamp(sentiment_score)
            + w.quality * self._quality(f)
        )

    @staticmethod
    def _quality(f: Fundamentals) -> float:
        """Dividend support, payout safety, and tradeability -- 0..1."""
        # A 5% yield scores full marks; nothing above that earns extra credit,
        # because past 5% the yield is usually pricing in a cut.
        income = clamp(f.dividend_yield / 0.05)

        if not f.pays_dividend or f.payout_ratio is None:
            payout_safety = 0.6           # nothing to cut is its own kind of safe
        elif f.payout_ratio <= 0.60:
            payout_safety = 1.0
        elif f.payout_ratio >= 1.20:
            payout_safety = 0.0
        else:
            payout_safety = 1.0 - (f.payout_ratio - 0.60) / 0.60

        liquidity = clamp(f.avg_dollar_volume / 50_000_000.0)
        return clamp(0.40 * income + 0.35 * payout_safety + 0.25 * liquidity)


def _empty_sentiment(ticker: str):
    from .models import SentimentRead
    return SentimentRead(ticker=ticker, score=0.0, article_count=0)
