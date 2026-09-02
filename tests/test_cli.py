"""CLI surface: argument plumbing, output modes, and error handling."""

import json

import pytest

from stock_deal_desk.cli import build_config, build_parser, main


def test_defaults_match_the_brief():
    cfg = build_config(build_parser().parse_args([]))
    assert cfg.screen.pe_min == 25.0        # "high P/E"
    assert cfg.screen.price_max == 25.0     # "low ticker price"
    assert cfg.screen.require_dividend is False   # "would be great", not required
    assert cfg.risk.kelly_haircut == 0.5


def test_screen_and_risk_flags_reach_the_config():
    args = build_parser().parse_args([
        "--pe-min", "40", "--price-max", "12", "--require-dividend",
        "--min-yield", "0.03", "--equity", "25000", "--max-risk", "0.01",
        "--max-heat", "0.04", "--max-positions", "3", "--kelly-haircut", "0.25",
    ])
    cfg = build_config(args)
    assert cfg.screen.pe_min == 40.0
    assert cfg.screen.price_max == 12.0
    assert cfg.screen.require_dividend is True
    assert cfg.screen.min_dividend_yield == 0.03
    assert cfg.risk.account_equity == 25_000.0
    assert cfg.risk.max_risk_per_trade == 0.01
    assert cfg.risk.max_portfolio_heat == 0.04
    assert cfg.risk.max_positions == 3
    assert cfg.risk.kelly_haircut == 0.25


def test_default_run_prints_a_report_and_the_synthetic_warning(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out
    assert "STOCK DEAL DESK" in out
    assert "SYNTHETIC DATA" in out
    assert "not investment advice" in out


def test_json_output_is_parseable_and_complete(capsys):
    assert main(["--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["is_live"] is False
    assert payload["regime"] in {"risk_on", "neutral", "risk_off"}
    assert payload["recommendations"]
    first = payload["recommendations"][0]
    assert {"ticker", "verdict", "fundamentals", "setup", "sentiment", "risk"} <= set(first)
    assert first["setup"]["reward_risk"] >= 0


def test_markdown_output_is_a_readable_report(capsys):
    assert main(["--markdown"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("# Deal desk")
    assert "## What kind of day is it?" in out
    assert "## What the desk would buy" in out


def test_show_passes_explains_the_rejections(capsys):
    main(["--show-passes"])
    with_passes = capsys.readouterr().out
    main([])
    without = capsys.readouterr().out
    assert len(with_passes) > len(without)
    assert "rejected names hidden" in without


def test_a_missing_snapshot_exits_with_an_error(capsys):
    assert main(["--snapshot", "/nonexistent/x.json"]) == 2
    assert "error:" in capsys.readouterr().err


def test_an_unknown_provider_is_rejected_by_argparse():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--provider", "bloomberg"])


def test_save_snapshot_writes_a_replayable_file(tmp_path, capsys):
    path = tmp_path / "snap.json"
    assert main(["--save-snapshot", str(path)]) == 0
    assert "snapshot written to" in capsys.readouterr().err
    assert path.exists()
    # ...and it replays.
    assert main(["--snapshot", str(path)]) == 0
    assert "STOCK DEAL DESK" in capsys.readouterr().out


def test_an_unwritable_snapshot_path_exits_with_an_error(tmp_path, capsys):
    # A regular file standing where a parent directory would have to go. This
    # fails as root too, unlike a merely nonexistent path.
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("")
    assert main(["--save-snapshot", str(blocker / "snap.json")]) == 2
    assert "could not write snapshot" in capsys.readouterr().err


def test_json_output_carries_provenance(capsys):
    main(["--json"])
    payload = json.loads(capsys.readouterr().out)
    assert payload["synthetic"] is True
    assert "provenance" in payload


def test_live_only_flags_have_sensible_defaults():
    args = build_parser().parse_args([])
    assert args.max_candidates == 40
    assert args.period == "2y"
    assert args.save_snapshot is None
