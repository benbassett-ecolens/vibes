"""Agent 2 of 4 -- hunts setups.

Two jobs, in order:

1. Apply the hard screen (high P/E, low share price, dividend preference).
   A name that fails is still published, with reasons, so the desk can explain
   itself rather than silently dropping candidates.
2. Score whatever survives on the tape: trend, momentum, where price sits in
   its own range, whether volume is confirming, and how stretched it is.

It also sets entry / stop / target in ATR units. Placing the stop in units of
the stock's own volatility -- not a flat percentage -- is what makes position
sizes comparable across a $3 name and a $24 name, which matters a lot in a
book screened on low nominal price.
"""

from __future__ import annotations

from ..bus import TOPIC_SETUP
from ..indicators import (
    atr, clamp, closes, drawdown_from_high, momentum, position_in_range, rsi, sma,
)
from ..models import Setup
from .base import Agent, AgentContext

# Stops are placed at structure (the recent swing low) but clamped into an ATR
# band: closer than 1 ATR and normal noise takes you out, further than 3 ATR and
# the loss is too big to size around. Targets work the same way against the
# 52-week high. Deriving both from structure -- rather than fixing a multiple --
# is what makes reward:risk *vary* between names, which is the whole point: it
# is the payoff input to the Kelly calculation downstream.
MIN_STOP_ATR = 1.0
MAX_STOP_ATR = 3.0
DEFAULT_TARGET_ATR = 4.5
BREAKOUT_TARGET_ATR = 5.0
MAX_RESISTANCE_ATR = 8.0
SWING_LOOKBACK = 20


class SetupHunterAgent(Agent):
    topic = TOPIC_SETUP
    name = "setup-hunter"

    def run(self, ctx: AgentContext) -> None:
        for ticker in ctx.provider.universe():
            setup = self._evaluate(ctx, ticker)
            if setup is not None:
                ctx.bus.publish(self.topic, setup)

    def _evaluate(self, ctx: AgentContext, ticker: str) -> Setup | None:
        fundamentals = ctx.provider.fundamentals(ticker)
        bars = ctx.provider.history(ticker)
        if fundamentals is None or len(bars) < 210:
            return None

        px = closes(bars)
        passed, reasons = self._screen(ctx, fundamentals)

        atr14 = atr(bars, 14) or (px[-1] * 0.03)
        entry = px[-1]
        notes: list[str] = []
        stop = self._stop(bars, entry, atr14)
        target = self._target(px, entry, atr14, notes)

        mom63 = momentum(px, 63) or 0.0
        rsi14 = rsi(px, 14) or 50.0
        dd = drawdown_from_high(px, 252)
        score = self._technical_score(px, bars, mom63, rsi14, dd, notes)

        return Setup(
            ticker=ticker,
            passed_screen=passed,
            screen_reasons=reasons,
            entry=round(entry, 4),
            stop=round(stop, 4),
            target=round(target, 4),
            atr=round(atr14, 4),
            technical_score=round(score, 4),
            momentum_63d=round(mom63, 4),
            drawdown_from_52w_high=round(dd, 4),
            rsi_14=round(rsi14, 2),
            notes=notes,
        )

    @staticmethod
    def _stop(bars, entry: float, atr14: float) -> float:
        """Structural stop: under the recent swing low, clamped to an ATR band."""
        swing_low = min(b.low for b in bars[-SWING_LOOKBACK:])
        furthest = entry - MAX_STOP_ATR * atr14
        closest = entry - MIN_STOP_ATR * atr14
        stop = max(furthest, min(swing_low * 0.995, closest))
        return round(max(0.01, stop), 4)

    @staticmethod
    def _target(px, entry: float, atr14: float, notes: list[str]) -> float:
        """Target the next real supply zone, not an arbitrary multiple."""
        year_high = max(px[-252:])
        if year_high <= entry:
            notes.append("at or above the 52w high -- no overhead supply, using an ATR projection")
            return round(entry + DEFAULT_TARGET_ATR * atr14, 4)
        if year_high < entry + 2.0 * atr14:
            notes.append(f"52w high at {year_high:.2f} is close overhead -- treating as a breakout target")
            return round(entry + BREAKOUT_TARGET_ATR * atr14, 4)
        if year_high <= entry + MAX_RESISTANCE_ATR * atr14:
            notes.append(f"target set just under the 52w high at {year_high:.2f}")
            return round(year_high * 0.995, 4)
        notes.append(f"52w high at {year_high:.2f} is too far to target; using an ATR projection")
        return round(entry + DEFAULT_TARGET_ATR * atr14, 4)

    @staticmethod
    def _screen(ctx: AgentContext, f) -> tuple[bool, list[str]]:
        """The literal brief: high P/E, low price, dividend preferred."""
        cfg = ctx.config.screen
        fails: list[str] = []
        passes: list[str] = []

        if f.pe_trailing is None:
            fails.append("no trailing P/E (unprofitable or not reported)")
        elif f.pe_trailing < cfg.pe_min:
            fails.append(f"P/E {f.pe_trailing:.1f} below the {cfg.pe_min:.0f} 'high P/E' floor")
        elif f.pe_trailing > cfg.pe_max:
            fails.append(f"P/E {f.pe_trailing:.1f} above {cfg.pe_max:.0f} -- earnings too small to be meaningful")
        else:
            passes.append(f"P/E {f.pe_trailing:.1f}")

        if f.price > cfg.price_max:
            fails.append(f"${f.price:.2f} above the ${cfg.price_max:.0f} price ceiling")
        elif f.price < cfg.price_min:
            fails.append(f"${f.price:.2f} below the ${cfg.price_min:.2f} floor -- spread and delisting risk")
        else:
            passes.append(f"${f.price:.2f}")

        if f.pays_dividend:
            passes.append(f"yields {f.dividend_yield:.1%}")
            if f.dividend_yield < cfg.min_dividend_yield:
                fails.append(f"yield {f.dividend_yield:.1%} below the {cfg.min_dividend_yield:.1%} minimum")
        elif cfg.require_dividend:
            fails.append("pays no dividend")
        else:
            passes.append("no dividend (preferred, not required)")

        if f.avg_dollar_volume < cfg.min_avg_dollar_volume:
            fails.append(f"${f.avg_dollar_volume/1e6:.1f}M daily dollar volume is too thin to trade")
        if f.market_cap < cfg.min_market_cap:
            fails.append(f"${f.market_cap/1e6:.0f}M market cap below the floor")

        reasons = fails if fails else passes
        return (not fails), reasons

    @staticmethod
    def _technical_score(px, bars, mom63: float, rsi14: float, dd: float,
                         notes: list[str]) -> float:
        """Blend five tape features into a 0..1 score."""
        ma50 = sma(px, 50) or px[-1]
        ma200 = sma(px, 200) or px[-1]

        # 1. Trend structure: price over 50 over 200 is the textbook stack.
        trend = 0.0
        if px[-1] > ma50:
            trend += 0.5
        if ma50 > ma200:
            trend += 0.5
        if trend == 1.0:
            notes.append("trend stacked: price > 50d > 200d")
        elif trend == 0.0:
            notes.append("downtrend: price below both moving averages")

        # 2. Momentum, mapped so -15% -> 0 and +30% -> 1.
        mom_score = clamp((mom63 + 0.15) / 0.45)

        # 3. RSI: reward the 45-65 band. Overbought is a worse entry, not a
        #    better one, and deeply oversold usually means still falling.
        if rsi14 > 75:
            rsi_score = 0.25
            notes.append(f"RSI {rsi14:.0f} is extended -- poor entry, wait for a pullback")
        elif rsi14 < 30:
            rsi_score = 0.20
            notes.append(f"RSI {rsi14:.0f} is oversold and may keep falling")
        else:
            rsi_score = 1.0 - abs(rsi14 - 55.0) / 30.0

        # 4. Position in the 52-week range. This screen hunts depressed
        #    earnings, so mid-range beats both the highs and the lows.
        pos = position_in_range(px, 252)
        range_score = 1.0 - abs(pos - 0.6) / 0.6

        # 5. Volume confirmation: is the recent tape busier than the base?
        recent_vol = sum(b.volume for b in bars[-20:]) / 20.0
        base_vol = sum(b.volume for b in bars[-100:]) / 100.0
        vol_score = clamp((recent_vol / base_vol - 0.8) / 0.6) if base_vol else 0.5
        if base_vol and recent_vol / base_vol > 1.3:
            notes.append(f"volume running {recent_vol/base_vol:.1f}x its 100d base")

        if dd > 0.55:
            notes.append(f"{dd:.0%} below the 52w high -- deep value or a value trap")

        return clamp(
            0.28 * trend
            + 0.24 * mom_score
            + 0.18 * clamp(rsi_score)
            + 0.18 * clamp(range_score)
            + 0.12 * vol_score
        )
