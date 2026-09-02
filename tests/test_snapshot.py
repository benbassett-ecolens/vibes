"""The capture/replay bridge.

The guarantee under test: a snapshot replays to byte-identical desk output.
That is what makes it safe to fetch on one machine and analyse on another.
"""

import json
import sys

import pytest

from fake_yfinance import FakeYFinance, make_frame, news_item
from stock_deal_desk import DealDesk
from stock_deal_desk.providers import capture, get_provider, save
from stock_deal_desk.providers.yahoo import YahooProvider
from stock_deal_desk.report import render


def test_a_captured_fixture_replays_identically(tmp_path):
    source = get_provider("fixture")
    path = save(source, tmp_path / "replay.json")
    replayed = get_provider("fixture", path=path)

    original = DealDesk(provider=source).run()
    again = DealDesk(provider=replayed).run()

    assert [(r.ticker, r.verdict, r.risk.shares, r.risk.position_dollars)
            for r in original.recommendations] == \
           [(r.ticker, r.verdict, r.risk.shares, r.risk.position_dollars)
            for r in again.recommendations]
    assert original.market.regime is again.market.regime
    assert original.portfolio_heat == pytest.approx(again.portfolio_heat)


def test_capture_preserves_every_security_and_its_bars():
    source = get_provider("fixture")
    snap = capture(source)
    assert set(snap["securities"]) == set(list(source.universe()) + ["SPY"])
    for ticker in source.universe():
        assert len(snap["securities"][ticker]["bars"]) == len(source.history(ticker))


def test_as_of_is_the_newest_bar_not_the_wall_clock():
    snap = capture(get_provider("fixture"))
    newest = max(r["bars"][-1]["date"] for r in snap["securities"].values() if r.get("bars"))
    assert snap["as_of"] == newest


def test_capturing_synthetic_data_stays_flagged_synthetic(tmp_path):
    path = save(get_provider("fixture"), tmp_path / "s.json")
    payload = json.loads(path.read_text())
    assert payload["synthetic"] is True
    assert payload["provenance"] == "synthetic"
    assert "SYNTHETIC" in payload["_warning"]


def test_capturing_live_data_is_flagged_as_a_replay(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "yfinance", FakeYFinance(
        quotes=[{"symbol": "AAA", "shortName": "AAA Corp", "sector": "Energy",
                 "regularMarketPrice": 12.0, "trailingPE": 33.0,
                 "dividendYield": 3.5, "marketCap": 5e9,
                 "averageDailyVolume3Month": 4e6}],
        info={"AAA": {"payoutRatio": 0.55}},
        news={"AAA": [news_item("AAA raises guidance")]},
        frames={s: make_frame(n=300) for s in ("AAA", "SPY")},
    ))
    path = save(YahooProvider(), tmp_path / "live.json")
    payload = json.loads(path.read_text())

    assert payload["synthetic"] is False
    assert payload["provenance"] == "captured-live"
    assert payload["source"] == "yahoo"
    assert payload["captured_at"]
    assert "NOT a live quote" in payload["_warning"]
    assert payload["securities"]["AAA"]["headlines"][0]["title"] == "AAA raises guidance"


def test_a_replayed_live_snapshot_reports_replay_not_synthetic(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "yfinance", FakeYFinance(
        quotes=[{"symbol": "AAA", "shortName": "AAA Corp", "sector": "Energy",
                 "regularMarketPrice": 12.0, "trailingPE": 33.0,
                 "dividendYield": 3.5, "marketCap": 5e9,
                 "averageDailyVolume3Month": 4e6}],
        info={"AAA": {"payoutRatio": 0.55}},
        frames={s: make_frame(n=300) for s in ("AAA", "SPY")},
    ))
    path = save(YahooProvider(), tmp_path / "live.json")

    run = DealDesk(provider=get_provider("fixture", path=path)).run()
    report = render(run)
    assert run.provider_synthetic is False
    assert run.provider_is_live is False
    assert "REPLAY" in report
    assert "SYNTHETIC" not in report
    assert "frozen at capture time" in report


def test_save_creates_missing_parent_directories(tmp_path):
    path = save(get_provider("fixture"), tmp_path / "deep" / "nested" / "s.json")
    assert path.exists()
