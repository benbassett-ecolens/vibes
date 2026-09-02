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
    """A plain-English report, written for a reader rather than a programmer.

    Every number is spelled out in dollars and in what it means, because the
    point of this report is to be *evaluated* -- you should be able to disagree
    with the desk without reading any code.
    """
    lines = [f"# Deal desk — {run.market.regime.value.replace('_', ' ')} — "
             f"{len(run.takes)} idea(s)", ""]
    lines += _md_status(run)
    lines += _md_market(run)
    lines += _md_book(run)
    lines += _md_watchlist(run)
    lines += _md_rejects(run)
    lines += _md_glossary()
    lines += ["", "---", f"_{DISCLAIMER}_"]
    return "\n".join(lines)


def _md_status(run: DeskRun) -> list[str]:
    if run.provider_synthetic:
        return ["> ⚠️ **These are made-up companies.** " + run.provider_note.capitalize() +
                ". The ticker symbols are real but every number is invented, so this "
                "shows you how the desk *thinks* — it is not a view on any real "
                "company.", ""]
    if not run.provider_is_live:
        return ["> 📌 **Real data, frozen in time.** " + run.provider_note.capitalize() +
                ". Prices have moved since it was captured.", ""]
    return ["> ✅ **Live data.** " + run.provider_note.capitalize() + ".", ""]


def _md_market(run: DeskRun) -> list[str]:
    m = run.market
    mood = {
        "risk_on": "The broad market is trending up and reasonably calm, so the desk "
                   "is willing to use its **full** risk budget.",
        "neutral": "The market is sending mixed signals, so the desk is only using "
                   "**60%** of its normal risk budget.",
        "risk_off": "The market is falling and jumpy, so the desk is using just "
                    "**25%** of its normal risk budget and mostly staying out.",
    }[m.regime.value]
    return [
        "## What kind of day is it?", "",
        mood, "",
        f"- The market index is **{m.index_trend:+.1%}** versus its long-run average.",
        f"- **{m.breadth:.0%}** of the stocks it looked at are in their own uptrend.",
        f"- Volatility is running at **{m.realized_vol:.0%}** a year "
        f"({'calm' if m.realized_vol < 0.18 else 'elevated' if m.realized_vol < 0.28 else 'high'}).",
        "",
    ]


def _md_book(run: DeskRun) -> list[str]:
    equity = run.config.risk.account_equity
    if not run.takes:
        return ["## What the desk would buy", "",
                "**Nothing today.** Every candidate failed at least one check. "
                "That is a real answer, not a bug — most days a strict screen "
                "should come up empty.", ""]

    lines = ["## What the desk would buy", "",
             f"Assuming a **${equity:,.0f}** account. "
             f"Total committed: **${run.deployed_dollars:,.0f}** "
             f"({run.deployed_dollars / equity:.0%} of the account). "
             f"If every single one hit its exit price you would lose "
             f"**${sum(r.risk.risk_dollars for r in run.takes):,.0f}** "
             f"({run.portfolio_heat:.1%} of the account).", ""]

    for i, r in enumerate(run.takes, 1):
        lines += _md_idea(i, r, equity)
    return lines


def _md_idea(index: int, r, equity: float) -> list[str]:
    f, st, se, k = r.fundamentals, r.setup, r.sentiment, r.risk
    upside = k.shares * (st.target - st.entry)
    lines = [
        f"### {index}. {r.ticker} — {r.name}",
        f"*{r.sector} · ${f.price:.2f} a share*", "",
        f"| | |",
        f"|---|---|",
        f"| **Buy** | {k.shares:,} shares at ~${st.entry:.2f} = **${k.position_dollars:,.0f}** |",
        f"| **Sell if it drops to** | ${st.stop:.2f} — you would lose "
        f"**${k.risk_dollars:,.0f}** ({k.risk_dollars / equity:.1%} of the account) |",
        f"| **Take profit near** | ${st.target:.2f} — you would make "
        f"**~${upside:,.0f}** |",
        f"| **Risking $1 to make** | ${st.reward_risk:.2f} |",
        "",
        "**Why the desk likes it**", "",
    ]
    lines += [f"- {reason}" for reason in _plain_reasons(r)]
    concerns = _plain_concerns(r)
    if concerns:
        lines += ["", "**What could go wrong**", ""]
        lines += [f"- {c}" for c in concerns]
    lines.append("")
    return lines


def _plain_reasons(r) -> list[str]:
    """Turn the agents' scores into sentences a person can argue with."""
    f, st, se = r.fundamentals, r.setup, r.sentiment
    out = []

    if st.technical_score >= 0.65:
        out.append("The price chart looks strong — it is trending up on rising volume.")
    elif st.technical_score >= 0.45:
        out.append("The price chart is decent, though not a standout.")
    else:
        out.append("The chart is unremarkable; this one is carried by the other signals.")

    if st.momentum_63d > 0.10:
        out.append(f"It is up **{st.momentum_63d:.0%}** over the last three months.")
    elif st.momentum_63d < -0.10:
        out.append(f"It is down **{abs(st.momentum_63d):.0%}** over three months — "
                   "the desk is buying weakness here, which is the riskier version of this trade.")

    if st.drawdown_from_52w_high > 0.25:
        out.append(f"It sits **{st.drawdown_from_52w_high:.0%}** below its 12-month high, "
                   "so there is room to recover before it hits old resistance.")

    if f.pays_dividend:
        cover = ""
        if f.payout_ratio is not None:
            cover = (" and the company earns more than enough to cover it"
                     if f.payout_ratio < 0.75 else
                     " though the dividend eats most of its earnings")
        out.append(f"It pays a **{f.dividend_yield:.1%}** dividend{cover}.")
    else:
        out.append("It pays no dividend, so the entire return has to come from the price.")

    if se.score > 0.3:
        out.append("Recent news coverage is positive.")
    elif se.score < -0.1:
        out.append("News coverage is slightly negative — worth reading before you act.")
    for catalyst in se.catalysts[:2]:
        out.append(f"Headline: *{catalyst}*")

    if f.pe_trailing is not None:
        out.append(f"Its P/E is **{f.pe_trailing:.0f}** — expensive against current earnings, "
                   "which is what this screen is deliberately looking for "
                   "(see the README on why).")
    return out


def _plain_concerns(r) -> list[str]:
    out = []
    for note in r.setup.notes:
        if "supply" in note or "overhead" in note or "extended" in note or "oversold" in note:
            out.append(note[0].upper() + note[1:] + ".")
    for veto in r.risk.vetoes:
        if "concentration-capped" in veto:
            out.append("The desk wanted to buy more but capped this at 10% of the "
                       "account so one bad name cannot do too much damage.")
        elif "trimmed" in veto:
            out.append("This was trimmed to fit inside the total risk budget.")
    if r.fundamentals.payout_ratio is not None and r.fundamentals.payout_ratio > 0.90:
        out.append(f"The dividend uses **{r.fundamentals.payout_ratio:.0%}** of earnings — "
                   "there is little cushion if profits slip.")
    if r.sentiment.article_count == 0:
        out.append("No recent news was found, so the sentiment check is blind here.")
    return out


def _md_watchlist(run: DeskRun) -> list[str]:
    if not run.watches:
        return []
    lines = ["## Close, but not today", "",
             "These passed the screen but the desk would not commit money yet.", "",
             "| Ticker | Name | Price | Why not |", "|---|---|---:|---|"]
    for r in run.watches:
        reason = r.risk.vetoes[0] if r.risk.vetoes else "did not rank high enough"
        lines.append(f"| {r.ticker} | {r.name} | ${r.fundamentals.price:.2f} | {reason} |")
    lines.append("")
    return lines


def _md_rejects(run: DeskRun) -> list[str]:
    rejects = [r for r in run.recommendations if r.verdict is Verdict.PASS]
    if not rejects:
        return []
    lines = ["<details>", f"<summary>Rejected: {len(rejects)} names, and why "
             "(click to expand)</summary>", "",
             "| Ticker | Name | Price | Rejected because |", "|---|---|---:|---|"]
    for r in rejects:
        reason = "; ".join(r.risk.vetoes) or "no reason recorded"
        if len(reason) > 150:
            reason = reason[:147] + "..."
        lines.append(f"| {r.ticker} | {r.name} | ${r.fundamentals.price:.2f} | {reason} |")
    lines += ["", "</details>", ""]
    return lines


def _md_glossary() -> list[str]:
    return [
        "<details>", "<summary>What the terms mean (click to expand)</summary>", "",
        "- **P/E ratio** — the share price divided by a year of per-share profit. "
        "A P/E of 30 means you pay $30 for every $1 of annual profit. High can mean "
        "'expensive', or it can mean 'profits are temporarily depressed'.",
        "- **Dividend yield** — the annual cash payout as a percentage of the share price.",
        "- **Payout ratio** — how much of the company's profit goes out as dividends. "
        "Over 100% means it is paying out more than it earns, which is not sustainable.",
        "- **Stop** — the price at which you admit you were wrong and sell. Deciding "
        "this *before* you buy is the single most useful habit in trading.",
        "- **Risking $1 to make $X** — the reward-to-risk ratio. Below about 2 the "
        "desk will not bother, because you have to be right too often to come out ahead.",
        "- **Risk budget / heat** — the total you would lose if every position hit its "
        "stop at once. The desk keeps this under 6% of the account.",
        "- **Regime** — whether the overall market is calm and rising (take more risk) "
        "or falling and jumpy (take less).",
        "", "</details>",
    ]
