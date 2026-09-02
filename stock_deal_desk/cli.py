"""Command line entry point: ``python -m stock_deal_desk``."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from .config import DeskConfig, RiskConfig, ScreenConfig
from .desk import DealDesk
from .providers import get_provider, save as save_snapshot
from .report import render, render_markdown


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="stock_deal_desk",
        description="A four-agent equity deal desk. Educational, not investment advice.",
    )
    p.add_argument("--provider", default="fixture", choices=["fixture", "yahoo"],
                   help="fixture = bundled synthetic snapshot (default); "
                        "yahoo = live quotes, needs yfinance and network access")
    p.add_argument("--snapshot", help="path to an alternative fixture JSON")
    p.add_argument("--universe", help="comma-separated tickers; overrides screener discovery")
    p.add_argument("--max-candidates", type=int, default=40,
                   help="cap on names pulled from the screener (yahoo provider)")
    p.add_argument("--period", default="2y",
                   help="history window to download, e.g. 1y, 2y, 5y")

    screen = p.add_argument_group("screen")
    screen.add_argument("--pe-min", type=float, default=25.0, help="high-P/E floor")
    screen.add_argument("--pe-max", type=float, default=150.0)
    screen.add_argument("--price-max", type=float, default=25.0, help="low-price ceiling")
    screen.add_argument("--price-min", type=float, default=3.0)
    screen.add_argument("--require-dividend", action="store_true",
                        help="reject names that pay nothing")
    screen.add_argument("--min-yield", type=float, default=0.0,
                        help="minimum dividend yield as a decimal, e.g. 0.03")

    risk = p.add_argument_group("risk")
    risk.add_argument("--equity", type=float, default=100_000.0)
    risk.add_argument("--kelly-haircut", type=float, default=0.5,
                      help="fraction of full Kelly to bet (0.5 = half Kelly)")
    risk.add_argument("--max-risk", type=float, default=0.02,
                      help="max fraction of equity at risk on one trade")
    risk.add_argument("--max-heat", type=float, default=0.06,
                      help="max fraction of equity at risk across the whole book")
    risk.add_argument("--max-positions", type=int, default=8)

    out = p.add_argument_group("output")
    out.add_argument("--show-passes", action="store_true",
                     help="also explain every rejected name")
    out.add_argument("--markdown", action="store_true", help="emit a markdown table")
    out.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    out.add_argument("--save-snapshot", metavar="PATH",
                     help="also write everything fetched to a replayable JSON "
                          "snapshot; replay it later with --snapshot PATH")
    return p


def build_config(args) -> DeskConfig:
    return DeskConfig(
        screen=ScreenConfig(
            pe_min=args.pe_min, pe_max=args.pe_max,
            price_max=args.price_max, price_min=args.price_min,
            require_dividend=args.require_dividend,
            min_dividend_yield=args.min_yield,
        ),
        risk=RiskConfig(
            account_equity=args.equity,
            kelly_haircut=args.kelly_haircut,
            max_risk_per_trade=args.max_risk,
            max_portfolio_heat=args.max_heat,
            max_positions=args.max_positions,
        ),
    )


def build_provider(args, config: DeskConfig):
    if args.provider == "fixture":
        return get_provider("fixture", path=args.snapshot) if args.snapshot \
            else get_provider("fixture")
    tickers = [t.strip().upper() for t in args.universe.split(",")] if args.universe else None
    return get_provider(
        "yahoo", tickers=tickers, screen=config.screen,
        max_candidates=args.max_candidates, period=args.period,
        benchmark=config.benchmark,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = build_config(args)
    try:
        provider = build_provider(args, config)
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    run = DealDesk(provider=provider, config=config).run()

    if args.save_snapshot:
        # Capture after the run so it reuses the data the agents already pulled
        # rather than issuing a second round of requests.
        try:
            written = save_snapshot(provider, args.save_snapshot,
                                    benchmark=config.benchmark)
            print(f"snapshot written to {written}", file=sys.stderr)
        except OSError as exc:
            print(f"error: could not write snapshot: {exc}", file=sys.stderr)
            return 2

    if args.json:
        print(json.dumps({
            "provider": run.provider_name,
            "is_live": run.provider_is_live,
            "synthetic": run.provider_synthetic,
            "provenance": run.provider_note,
            "regime": run.market.regime.value,
            "universe_size": run.universe_size,
            "screened_in": run.screened_in,
            "portfolio_heat": run.portfolio_heat,
            "deployed_dollars": run.deployed_dollars,
            "expected_log_growth": run.expected_log_growth,
            "recommendations": [
                {
                    "ticker": r.ticker, "name": r.name, "sector": r.sector,
                    "verdict": r.verdict.value, "composite_score": r.composite_score,
                    "fundamentals": asdict(r.fundamentals),
                    "setup": asdict(r.setup) | {"reward_risk": r.setup.reward_risk},
                    "sentiment": asdict(r.sentiment),
                    "risk": asdict(r.risk) | {"verdict": r.risk.verdict.value},
                }
                for r in run.recommendations
            ],
        }, indent=2))
    elif args.markdown:
        print(render_markdown(run))
    else:
        print(render(run, show_passes=args.show_passes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
