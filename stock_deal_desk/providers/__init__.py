"""Market data providers.

The desk never talks to a data vendor directly -- it talks to this protocol.
That is what lets the same four agents run against a frozen snapshot in CI and
against live quotes on your machine without a line of agent code changing.
"""

from __future__ import annotations

from typing import Protocol, Sequence, runtime_checkable

from ..models import Bar, Fundamentals, Headline


@runtime_checkable
class DataProvider(Protocol):
    name: str

    def universe(self) -> Sequence[str]: ...
    def fundamentals(self, ticker: str) -> Fundamentals | None: ...
    def history(self, ticker: str) -> Sequence[Bar]: ...
    def headlines(self, ticker: str) -> Sequence[Headline]: ...
    def benchmark_history(self) -> Sequence[Bar]: ...
    def is_live(self) -> bool: ...


def get_provider(kind: str, **kwargs):
    """Resolve a provider by name. Imports lazily so yfinance stays optional."""
    kind = kind.lower()
    if kind in ("fixture", "snapshot", "offline"):
        from .fixture import FixtureProvider
        return FixtureProvider(**kwargs)
    if kind in ("yahoo", "yfinance", "live"):
        from .yahoo import YahooProvider
        return YahooProvider(**kwargs)
    raise ValueError(f"unknown provider {kind!r}; expected 'fixture' or 'yahoo'")


__all__ = ["DataProvider", "get_provider"]
