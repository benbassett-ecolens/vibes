"""Capture any provider's current view into a replayable JSON snapshot.

This is the bridge between a machine that can reach a data vendor and one that
cannot. Run the desk live once with ``--save-snapshot``, and the resulting file
replays through ``FixtureProvider`` anywhere -- in CI, on a plane, or in a
sandbox with no egress -- against the identical agents.

A captured snapshot is real data but it is *not live*: it is a frozen moment,
and the desk labels it that way so a replay is never mistaken for a fresh quote.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Sequence


def capture(provider, benchmark: str = "SPY") -> dict:
    """Pull everything the desk would read and return a snapshot dict."""
    securities: dict[str, dict] = {}
    tickers: Sequence[str] = list(provider.universe())

    for ticker in tickers:
        record: dict = {}
        fundamentals = provider.fundamentals(ticker)
        if fundamentals is not None:
            payload = asdict(fundamentals)
            payload.pop("ticker", None)   # the key already carries it
            record["fundamentals"] = payload
        record["bars"] = [asdict(bar) for bar in provider.history(ticker)]
        record["headlines"] = [
            {"date": h.date, "source": h.source, "title": h.title}
            for h in provider.headlines(ticker)
        ]
        if record.get("bars") or record.get("fundamentals"):
            securities[ticker] = record

    benchmark_bars = [asdict(bar) for bar in provider.benchmark_history()]
    if benchmark_bars:
        securities.setdefault(benchmark, {})["bars"] = benchmark_bars
        securities[benchmark].setdefault("headlines", [])

    synthetic = bool(getattr(provider, "synthetic", not provider.is_live()))
    return {
        "_warning": (
            "SYNTHETIC DATA -- generated, describes no real company."
            if synthetic else
            "Real market data, captured at a point in time. NOT a live quote; "
            "prices and fundamentals were current only as of captured_at."
        ),
        "synthetic": synthetic,
        "provenance": "synthetic" if synthetic else "captured-live",
        "source": provider.name,
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": _latest_bar_date(securities) or date.today().isoformat(),
        "benchmark": benchmark,
        "securities": securities,
    }


def save(provider, path: str | Path, benchmark: str = "SPY") -> Path:
    """Capture and write to ``path``. Returns the path written."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = capture(provider, benchmark=benchmark)
    with destination.open("w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    return destination


def _latest_bar_date(securities: dict) -> str | None:
    """The newest bar across the snapshot -- what the data is actually 'as of'."""
    latest = None
    for record in securities.values():
        bars = record.get("bars") or []
        if not bars:
            continue
        candidate = bars[-1].get("date")
        if candidate and (latest is None or candidate > latest):
            latest = candidate
    return latest
