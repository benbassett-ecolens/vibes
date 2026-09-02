"""Rendering a desk run for a terminal or a markdown file."""

from __future__ import annotations

from .desk import DeskRun
from .models import Recommendation, Verdict

DISCLAIMER = (
    "Educational project, not investment advice. Nothing here has been "
    "backtested; the win probabilities are heuristic, not measured."
)


def render(run: DeskRun, show_passes: bool = False, width: int = 78) -> str:
    out: list[str] = []
    rule = "=" * width
    thin = "-" * width

    out.append(rule)
    out.append("STOCK DEAL DESK".center(width))
    out.append(rule)

    out.append("")
    if run.provider_synthetic:
        out.append("!! SYNTHETIC DATA -- {}.".format(run.provider_note))
        out.append("!! These prices, P/E ratios and headlines are generated, not market")
        out.append("!! data, and describe no real company. For real quotes, run with")
        out.append("!! --provider yahoo on a machine that can reach Yahoo Finance.")
    elif not run.provider_is_live:
        out.append("!! REPLAY -- {}.".format(run.provider_note))
        out.append("!! This is real market data, but frozen at capture time. Prices have")
        out.append("!! moved since. Re-run live before acting on anything here.")
    else:
        out.append("   LIVE -- {}.".format(run.provider_note))

    # ---- market
    out.append("")
    out.append("MARKET WATCH")
    out.append(thin)
    m = run.market
    out.append(f"  regime            {m.regime.value.upper()}  "
               f"(risk budget x{m.regime.budget_multiplier:.2f})")
    out.append(f"  benchmark trend   {m.index_trend:+.1%} vs its 200d average")
    out.append(f"  realised vol      {m.realized_vol:.1%} annualised")
    out.append(f"  breadth           {m.breadth:.0%} of the universe above its 50d average")
    for note in m.notes:
        out.append(f"    - {note}")

    # ---- screen
    out.append("")
    out.append("SCREEN")
    out.append(thin)
    s = run.config.screen
    out.append(f"  P/E between {s.pe_min:.0f} and {s.pe_max:.0f}, "
               f"price ${s.price_min:.2f}-${s.price_max:.2f}, "
               f"dividend {'required' if s.require_dividend else 'preferred'}")
    out.append(f"  {run.screened_in} of {run.universe_size} names passed")

    # ---- book
    out.append("")
    out.append("RECOMMENDED BOOK")
    out.append(thin)
    takes = run.takes
    if not takes:
        out.append("  Nothing clears the desk today. That is a valid output.")
    else:
        out.append(f"  {'TICKER':<7}{'ENTRY':>8}{'STOP':>8}{'TARGET':>8}{'R:R':>6}"
                   f"{'SHARES':>8}{'COST':>10}{'RISK':>8}")
        for r in takes:
            k, st = r.risk, r.setup
            out.append(f"  {r.ticker:<7}{st.entry:>8.2f}{st.stop:>8.2f}{st.target:>8.2f}"
                       f"{st.reward_risk:>6.1f}{k.shares:>8}{k.position_dollars:>10,.0f}"
                       f"{k.risk_dollars:>8,.0f}")
        out.append("")
        out.append(f"  capital deployed  ${run.deployed_dollars:,.0f} of "
                   f"${run.config.risk.account_equity:,.0f} "
                   f"({run.deployed_dollars / run.config.risk.account_equity:.0%})")
        out.append(f"  portfolio heat    {run.portfolio_heat:.2%} of "
                   f"{run.config.risk.max_portfolio_heat:.2%} budget "
                   f"(total loss if every stop is hit)")
        out.append(f"  E[log growth]     {run.expected_log_growth:+.4f} per holding period, "
                   f"~{run.expected_log_growth * 100:.2f}% compounded")

    # ---- detail
    out.append("")
    out.append("THE CASE FOR EACH NAME")
    out.append(thin)
    shown = [r for r in run.recommendations
             if r.verdict is not Verdict.PASS or show_passes]
    for r in shown:
        out.extend(_detail(r, width))

    if not show_passes:
        passes = len([r for r in run.recommendations if r.verdict is Verdict.PASS])
        out.append(f"  ({passes} rejected names hidden; pass --show-passes to see why each failed)")

    out.append("")
    out.append(thin)
    out.append("  " + DISCLAIMER)
    out.append(rule)
    return "\n".join(out)


def _detail(r: Recommendation, width: int) -> list[str]:
    f, st, se, k = r.fundamentals, r.setup, r.sentiment, r.risk
    lines = ["", f"  [{k.verdict.value.upper()}] {r.ticker} -- {r.name} ({r.sector})"]

    dividend = f"{f.dividend_yield:.1%} yield" if f.pays_dividend else "no dividend"
    payout = f", {f.payout_ratio:.0%} payout" if f.payout_ratio is not None else ""
    pe = f"{f.pe_trailing:.1f}" if f.pe_trailing is not None else "n/a"
    lines.append(f"      ${f.price:.2f}  P/E {pe}  {dividend}{payout}  "
                 f"mcap ${f.market_cap/1e9:.1f}B")
    lines.append(f"      technicals: score {st.technical_score:.2f}, "
                 f"63d momentum {st.momentum_63d:+.1%}, RSI {st.rsi_14:.0f}, "
                 f"{st.drawdown_from_52w_high:.0%} off the 52w high")
    lines.append(f"      news: {se.score:+.2f} across {se.article_count} headline(s)")
    for catalyst in se.catalysts:
        lines.append(f"        + {catalyst}")
    for landmine in se.landmines:
        lines.append(f"        ! {landmine}")
    for note in st.notes:
        lines.append(f"      . {note}")

    if k.verdict is Verdict.TAKE:
        lines.append(f"      sizing: {k.win_probability:.0%} est. hit rate at "
                     f"{st.reward_risk:.1f}:1 -> Kelly {k.kelly_fraction:.1%}, "
                     f"risking {k.applied_fraction:.2%}")
        lines.append(f"              {k.shares} shares = ${k.position_dollars:,.0f}, "
                     f"${k.risk_dollars:,.0f} at risk to the stop")
    for veto in k.vetoes:
        lines.append(f"      x {veto}")
    return lines


def render_markdown(run: DeskRun) -> str:
    """A markdown table version, for pasting into notes or a PR."""
    lines = ["# Stock deal desk", ""]
    if run.provider_synthetic:
        lines += [f"> **Synthetic data.** {run.provider_note}; these numbers are generated "
                  "and describe no real company.", ""]
    elif not run.provider_is_live:
        lines += [f"> **Replay.** {run.provider_note}. Real data, frozen at capture time — "
                  "prices have moved since.", ""]
    else:
        lines += [f"> **Live.** {run.provider_note}.", ""]
    lines += [
        f"**Regime:** {run.market.regime.value.upper()} "
        f"(risk budget x{run.market.regime.budget_multiplier:.2f}) | "
        f"**Screened in:** {run.screened_in}/{run.universe_size}",
        "",
        "| Ticker | Name | Verdict | Price | P/E | Yield | R:R | Shares | Cost | Risk |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for r in run.recommendations:
        f, st, k = r.fundamentals, r.setup, r.risk
        pe = f"{f.pe_trailing:.1f}" if f.pe_trailing is not None else "-"
        lines.append(
            f"| {r.ticker} | {r.name} | {k.verdict.value} | ${f.price:.2f} | {pe} | "
            f"{f.dividend_yield:.1%} | {st.reward_risk:.1f} | {k.shares or '-'} | "
            f"${k.position_dollars:,.0f} | ${k.risk_dollars:,.0f} |"
        )
    lines += ["", f"_{DISCLAIMER}_"]
    return "\n".join(lines)
