"""A hand-built provider so agent tests do not depend on the bundled snapshot."""

import math

import pytest

from stock_deal_desk.bus import MessageBus
from stock_deal_desk.config import DeskConfig
from stock_deal_desk.agents.base import AgentContext
from stock_deal_desk.models import Bar, Fundamentals, Headline


def make_bars(n=300, start=10.0, drift=0.0005, wiggle=0.004, chop=0.0):
    """A smooth, deterministic ramp -- no RNG, so assertions are exact.

    ``wiggle`` is a slow sine that barely moves realised volatility; ``chop``
    alternates the sign every bar, which is what actually produces day-to-day
    return variance when a test needs a genuinely volatile tape.
    """
    bars = []
    price = start
    for i in range(n):
        price *= math.exp(drift)
        noise = wiggle * math.sin(i / 3.0) + (chop if i % 2 == 0 else -chop)
        close = price * (1 + noise)
        bars.append(Bar(
            date=f"2025-01-{(i % 28) + 1:02d}",
            open=close * 0.999, high=close * 1.012, low=close * 0.988,
            close=close, volume=1_000_000.0,
        ))
    return bars


class StubProvider:
    name = "stub"
    as_of = "2026-08-28"

    def __init__(self, fundamentals=None, bars=None, headlines=None, benchmark=None):
        self._fundamentals = fundamentals or {}
        self._bars = bars or {}
        self._headlines = headlines or {}
        self._benchmark = benchmark if benchmark is not None else make_bars()

    def is_live(self):
        return False

    def universe(self):
        return list(self._fundamentals)

    def fundamentals(self, ticker):
        return self._fundamentals.get(ticker)

    def history(self, ticker):
        return self._bars.get(ticker, make_bars())

    def headlines(self, ticker):
        return self._headlines.get(ticker, [])

    def benchmark_history(self):
        return self._benchmark


def make_fundamentals(ticker="XYZ", **overrides):
    defaults = dict(
        ticker=ticker, name=f"{ticker} Inc", sector="Technology", price=12.00,
        pe_trailing=35.0, pe_forward=30.0, eps_trailing=0.34,
        dividend_yield=0.04, payout_ratio=0.70, market_cap=5e9,
        shares_out=4.2e8, avg_dollar_volume=40e6,
    )
    defaults.update(overrides)
    return Fundamentals(**defaults)


@pytest.fixture
def bus():
    return MessageBus()


@pytest.fixture
def make_ctx(bus):
    def _make(provider, config=None):
        return AgentContext(provider=provider, config=config or DeskConfig(), bus=bus)
    return _make


@pytest.fixture
def headline():
    def _make(ticker="XYZ", title="Something happened", source="Reuters", date="2026-08-27"):
        return Headline(ticker=ticker, date=date, source=source, title=title)
    return _make
