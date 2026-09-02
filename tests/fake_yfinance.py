"""A stand-in for yfinance, so the live provider is tested without a network.

It mimics only the surface the provider actually touches, matching the shapes
verified against yfinance 1.7.0: ``screen()`` returns the object under
``finance.result[0]`` (i.e. a dict with "quotes"), ``get_news()`` returns
stream entries whose payload sits under "content", and ``download()`` returns
a column-MultiIndexed frame when given more than one symbol.
"""

from __future__ import annotations

import types

import pandas as pd


class EquityQuery:
    """Records the operator/operand tree so tests can assert on the query."""

    def __init__(self, operator, operand):
        self.operator = operator
        self.operand = operand

    def fields(self) -> set[str]:
        """Every field name mentioned anywhere in the tree."""
        found = set()
        if self.operator in ("and", "or"):
            for child in self.operand:
                found |= child.fields()
        elif self.operand and isinstance(self.operand[0], str):
            found.add(self.operand[0])
        return found

    def clause(self, field: str):
        """The operand list for ``field``, or None."""
        if self.operator in ("and", "or"):
            for child in self.operand:
                hit = child.clause(field)
                if hit is not None:
                    return hit
            return None
        if self.operand and self.operand[0] == field:
            return self.operand
        return None


def make_frame(n=260, start=10.0, step=0.02, with_nan_row=False):
    index = pd.date_range("2024-01-01", periods=n, freq="D")
    closes = [start + i * step for i in range(n)]
    frame = pd.DataFrame({
        "Open": [c * 0.99 for c in closes],
        "High": [c * 1.02 for c in closes],
        "Low": [c * 0.98 for c in closes],
        "Close": closes,
        "Volume": [1_000_000.0] * n,
    }, index=index)
    if with_nan_row:
        frame.iloc[5] = float("nan")
    return frame


class FakeYFinance(types.ModuleType):
    def __init__(self, quotes=None, info=None, news=None, frames=None,
                 screen_error=None, download_error=None):
        super().__init__("yfinance")
        self.EquityQuery = EquityQuery
        self._quotes = quotes if quotes is not None else []
        self._info = info or {}
        self._news = news or {}
        self._frames = frames or {}
        self._screen_error = screen_error
        self._download_error = download_error
        self.screen_calls: list = []
        self.download_calls: list = []
        self.info_calls: list[str] = []

    # ---- module-level API
    def screen(self, query, size=None, sortField=None, sortAsc=None, **kw):
        self.screen_calls.append({"query": query, "size": size, "sortField": sortField})
        if self._screen_error:
            raise self._screen_error
        return {"quotes": list(self._quotes), "count": len(self._quotes)}

    def download(self, symbols, **kwargs):
        self.download_calls.append({"symbols": list(symbols), "kwargs": kwargs})
        if self._download_error:
            raise self._download_error
        symbols = list(symbols)
        if len(symbols) == 1:
            return self._frame_for(symbols[0])
        frames = {s: self._frame_for(s) for s in symbols}
        return pd.concat(frames, axis=1)

    def _frame_for(self, symbol):
        return self._frames.get(symbol, make_frame())

    def Ticker(self, symbol):
        return FakeTicker(symbol, self)


class FakeTicker:
    def __init__(self, symbol, module):
        self.ticker = symbol
        self._module = module

    @property
    def info(self):
        self._module.info_calls.append(self.ticker)
        return self._module._info.get(self.ticker, {})

    def get_news(self, count=10, tab="news"):
        return self._module._news.get(self.ticker, [])

    def history(self, period=None, interval=None):
        return self._module._frame_for(self.ticker)


def news_item(title, source="Reuters", pub="2026-08-27T10:00:00Z"):
    return {"content": {"title": title, "pubDate": pub,
                        "provider": {"displayName": source}}}
