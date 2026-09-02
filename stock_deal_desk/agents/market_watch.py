"""Agent 1 of 4 -- watches the market.

This agent takes no view on individual names. Its only job is to decide how
much risk the desk is allowed to run today, because the single largest driver
of a small-cap, low-priced book's outcome is the tape it is traded into. Its
output multiplies every position size the risk agent computes.
"""

from __future__ import annotations

from ..bus import TOPIC_MARKET
from ..indicators import closes, momentum, realized_vol, sma
from ..models import MarketView, Regime
from .base import Agent, AgentContext


class MarketWatchAgent(Agent):
    topic = TOPIC_MARKET
    name = "market-watch"

    def run(self, ctx: AgentContext) -> None:
        bars = ctx.provider.benchmark_history()
        notes: list[str] = []

        if len(bars) < 200:
            notes.append(
                f"only {len(bars)} benchmark bars available; defaulting to NEUTRAL"
            )
            ctx.bus.publish(self.topic, MarketView(
                regime=Regime.NEUTRAL, index_trend=0.0, realized_vol=0.0,
                breadth=0.5, notes=notes,
            ))
            return

        px = closes(bars)
        ma200 = sma(px, 200) or px[-1]
        ma50 = sma(px, 50) or px[-1]
        trend = px[-1] / ma200 - 1.0
        vol = realized_vol(px, 63) or 0.0
        breadth = self._breadth(ctx)

        # Only interpretive notes here -- the raw numbers are reported alongside.
        if ma50 < ma200:
            notes.append("50d average is below the 200d -- longer-term trend is not confirmed")

        regime = self._classify(trend, vol, breadth)
        mom = momentum(px, 21)
        if mom is not None and mom < -0.06 and regime is Regime.RISK_ON:
            regime = Regime.NEUTRAL
            notes.append(f"downgraded to NEUTRAL: benchmark fell {mom:.1%} over 21 sessions")

        notes.append(
            f"regime {regime.value.upper()} -> deploying "
            f"{regime.budget_multiplier:.0%} of the normal risk budget"
        )
        ctx.bus.publish(self.topic, MarketView(
            regime=regime, index_trend=trend, realized_vol=vol,
            breadth=breadth, notes=notes,
        ))

    @staticmethod
    def _classify(trend: float, vol: float, breadth: float) -> Regime:
        score = 0
        score += 1 if trend > 0.02 else (-1 if trend < -0.03 else 0)
        score += 1 if breadth > 0.55 else (-1 if breadth < 0.35 else 0)
        score += 1 if vol < 0.18 else (-1 if vol > 0.28 else 0)
        if score >= 2:
            return Regime.RISK_ON
        if score <= -2:
            return Regime.RISK_OFF
        return Regime.NEUTRAL

    @staticmethod
    def _breadth(ctx: AgentContext) -> float:
        above = total = 0
        for ticker in ctx.provider.universe():
            px = closes(ctx.provider.history(ticker))
            ma = sma(px, 50)
            if ma is None:
                continue
            total += 1
            above += 1 if px[-1] > ma else 0
        return above / total if total else 0.5
