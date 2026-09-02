"""Agent 4 of 4 -- manages risk. The only agent allowed to say "size".

It runs in two passes:

*Per name* (``run``): hard vetoes first, then growth-optimal sizing. Vetoes are
absolute -- no chart is good enough to override a going-concern warning or a
dividend that is not funded by earnings.

*Per portfolio* (``apply_portfolio_constraints``): once the desk has ranked the
survivors, walk them best-first and enforce the book-level limits -- total heat,
sector concentration, position count. A name that is fine on its own but would
make the book its third regional bank gets demoted to WATCH, not sized.

Sizing is fractional Kelly. See sizing.py for why that is the correct answer to
"maximise capital growth", and why the desk deliberately bets less than it.
"""

from __future__ import annotations

from dataclasses import replace

from ..bus import TOPIC_MARKET, TOPIC_RISK, TOPIC_SENTIMENT, TOPIC_SETUP
from ..models import Fundamentals, MarketView, Regime, RiskDecision, Setup, Verdict
from ..sizing import (
    expected_log_growth, implied_win_probability, kelly_fraction, shares_for_risk,
)
from .base import Agent, AgentContext

MIN_TECHNICAL_SCORE_TO_TAKE = 0.40
BEARISH_SENTIMENT_FLOOR = -0.25
MAX_SHARE_OF_DAILY_VOLUME = 0.05


class RiskManagerAgent(Agent):
    topic = TOPIC_RISK
    name = "risk-manager"

    def run(self, ctx: AgentContext) -> None:
        market: MarketView | None = ctx.bus.latest(TOPIC_MARKET)
        regime = market.regime if market else Regime.NEUTRAL
        sentiments = ctx.bus.by_ticker(TOPIC_SENTIMENT)

        for setup in ctx.bus.read(TOPIC_SETUP):
            fundamentals = ctx.provider.fundamentals(setup.ticker)
            if fundamentals is None:
                continue
            sentiment = sentiments.get(setup.ticker)
            ctx.bus.publish(self.topic, self._decide(ctx, setup, fundamentals, sentiment, regime))

    # ---------------------------------------------------------------- per name

    def _decide(self, ctx: AgentContext, setup: Setup, f: Fundamentals,
                sentiment, regime: Regime) -> RiskDecision:
        cfg = ctx.config.risk
        vetoes = self._vetoes(cfg, setup, f, sentiment)

        sentiment_score = sentiment.score if sentiment else 0.0
        win_p = implied_win_probability(
            setup.technical_score, sentiment_score, regime.budget_multiplier
        )
        payoff = setup.reward_risk
        raw_kelly = kelly_fraction(win_p, payoff)

        if raw_kelly <= 0 and not vetoes:
            vetoes.append(
                f"no positive edge: {win_p:.0%} estimated hit rate at {payoff:.1f}:1 "
                f"reward:risk implies a negative Kelly fraction"
            )

        if vetoes:
            return RiskDecision(
                ticker=setup.ticker, verdict=Verdict.PASS, vetoes=vetoes,
                kelly_fraction=round(raw_kelly, 4), applied_fraction=0.0,
                risk_dollars=0.0, shares=0, position_dollars=0.0,
                expected_log_growth=0.0, win_probability=round(win_p, 4),
            )

        # Haircut Kelly, then scale by what the market-watch agent allows today.
        applied = raw_kelly * cfg.kelly_haircut * regime.budget_multiplier
        applied = min(applied, cfg.max_risk_per_trade)

        risk_dollars = applied * cfg.account_equity
        shares = shares_for_risk(risk_dollars, setup.entry, setup.stop)

        # Cap notional exposure, not just risk: a tight stop can otherwise buy
        # an enormous position in a low-priced name.
        max_notional = cfg.max_position_weight * cfg.account_equity
        notes: list[str] = []
        if shares * setup.entry > max_notional:
            shares = int(max_notional // setup.entry)
            # Worth saying out loud. On low-priced names with tight structural
            # stops, risk-per-share is so small that the concentration limit --
            # not the risk limit -- ends up setting the size. The desk is then
            # running less risk than it budgeted, and a gap through the stop is
            # the exposure that actually matters.
            notes.append(
                f"concentration-capped at {cfg.max_position_weight:.0%} of equity "
                f"(${max_notional:,.0f}); the {cfg.max_risk_per_trade:.0%} risk "
                f"budget alone would have bought more"
            )

        position_dollars = shares * setup.entry
        actual_risk = shares * (setup.entry - setup.stop)
        actual_fraction = actual_risk / cfg.account_equity if cfg.account_equity else 0.0

        verdict = Verdict.TAKE
        if shares <= 0:
            verdict = Verdict.WATCH
            vetoes.append("position rounds to zero shares at this account equity")
        elif setup.technical_score < MIN_TECHNICAL_SCORE_TO_TAKE:
            verdict = Verdict.WATCH
            vetoes.append(
                f"technical score {setup.technical_score:.2f} is below the "
                f"{MIN_TECHNICAL_SCORE_TO_TAKE:.2f} floor -- setup not confirmed yet"
            )
        elif sentiment_score < BEARISH_SENTIMENT_FLOOR:
            verdict = Verdict.WATCH
            vetoes.append(
                f"news flow is net negative ({sentiment_score:+.2f}) -- wait for the "
                f"narrative to turn before committing capital"
            )

        if verdict is not Verdict.TAKE:
            # A name the desk is not taking must not report a size. Showing one
            # invites somebody to act on a position the desk explicitly refused.
            return RiskDecision(
                ticker=setup.ticker, verdict=verdict, vetoes=vetoes,
                kelly_fraction=round(raw_kelly, 4), applied_fraction=0.0,
                risk_dollars=0.0, shares=0, position_dollars=0.0,
                expected_log_growth=0.0, win_probability=round(win_p, 4),
            )

        return RiskDecision(
            ticker=setup.ticker, verdict=verdict, vetoes=vetoes + notes,
            kelly_fraction=round(raw_kelly, 4),
            applied_fraction=round(actual_fraction, 5),
            risk_dollars=round(actual_risk, 2),
            shares=shares,
            position_dollars=round(position_dollars, 2),
            expected_log_growth=round(expected_log_growth(actual_fraction, win_p, payoff), 6),
            win_probability=round(win_p, 4),
        )

    @staticmethod
    def _vetoes(cfg, setup: Setup, f: Fundamentals, sentiment) -> list[str]:
        vetoes: list[str] = []

        if not setup.passed_screen:
            vetoes.append("failed the screen: " + "; ".join(setup.screen_reasons))

        if sentiment is not None and sentiment.has_landmine and cfg.veto_on_landmine:
            vetoes.append("news landmine: " + ", ".join(sentiment.landmines))

        if setup.reward_risk < cfg.min_reward_risk:
            vetoes.append(
                f"reward:risk {setup.reward_risk:.1f} below the {cfg.min_reward_risk:.1f} minimum"
            )

        if f.pays_dividend and f.payout_ratio is not None and f.payout_ratio > cfg.max_payout_ratio:
            vetoes.append(
                f"payout ratio {f.payout_ratio:.0%} exceeds {cfg.max_payout_ratio:.0%} -- "
                f"the {f.dividend_yield:.1%} yield is not covered by earnings and is a cut candidate"
            )

        # A position larger than a few percent of a day's volume cannot be exited
        # in a hurry. Non-binding at small account sizes, decisive at large ones.
        max_notional = cfg.max_position_weight * cfg.account_equity
        if f.avg_dollar_volume * MAX_SHARE_OF_DAILY_VOLUME < max_notional:
            vetoes.append(
                f"a ${max_notional:,.0f} position is more than "
                f"{MAX_SHARE_OF_DAILY_VOLUME:.0%} of ${f.avg_dollar_volume/1e6:.1f}M "
                f"daily volume -- cannot be exited quickly"
            )

        return vetoes

    # ----------------------------------------------------------- per portfolio

    @staticmethod
    def apply_portfolio_constraints(
        decisions: list[RiskDecision],
        sectors: dict[str, str],
        cfg,
    ) -> list[RiskDecision]:
        """Walk ranked decisions best-first, enforcing book-level limits.

        ``decisions`` must already be in the desk's ranked order -- the limits
        are allocated to the best names first, which is the whole point.
        """
        heat = 0.0
        taken = 0
        per_sector: dict[str, int] = {}
        out: list[RiskDecision] = []

        for decision in decisions:
            if decision.verdict is not Verdict.TAKE:
                out.append(decision)
                continue

            sector = sectors.get(decision.ticker, "Unknown")
            reasons: list[str] = []

            if taken >= cfg.max_positions:
                reasons.append(f"book already holds the {cfg.max_positions}-position maximum")
            if per_sector.get(sector, 0) >= cfg.max_names_per_sector:
                reasons.append(
                    f"already {cfg.max_names_per_sector} names in {sector} -- "
                    f"correlation limit reached"
                )

            remaining_heat = cfg.max_portfolio_heat - heat
            if not reasons and decision.applied_fraction > remaining_heat:
                if remaining_heat <= 0.001:
                    reasons.append(
                        f"portfolio heat budget of {cfg.max_portfolio_heat:.1%} is fully allocated"
                    )
                else:
                    # Room for a partial: scale the position to the heat left.
                    scale = remaining_heat / decision.applied_fraction
                    scaled_shares = int(decision.shares * scale)
                    if scaled_shares <= 0:
                        reasons.append("remaining heat budget is too small for one share")
                    else:
                        per_share_risk = (
                            decision.risk_dollars / decision.shares if decision.shares else 0.0
                        )
                        decision = replace(
                            decision,
                            shares=scaled_shares,
                            risk_dollars=round(scaled_shares * per_share_risk, 2),
                            position_dollars=round(
                                decision.position_dollars * scaled_shares / decision.shares, 2
                            ),
                            applied_fraction=round(decision.applied_fraction * scale, 5),
                            vetoes=decision.vetoes + [
                                f"trimmed to fit the remaining {remaining_heat:.2%} heat budget"
                            ],
                        )

            if reasons:
                out.append(replace(
                    decision, verdict=Verdict.WATCH, shares=0, risk_dollars=0.0,
                    position_dollars=0.0, applied_fraction=0.0, expected_log_growth=0.0,
                    vetoes=decision.vetoes + reasons,
                ))
                continue

            heat += decision.applied_fraction
            taken += 1
            per_sector[sector] = per_sector.get(sector, 0) + 1
            out.append(decision)

        return out
