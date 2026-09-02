"""The plain-English report.

This report exists to be read by someone who does not code and cannot inspect
the objects behind it, so these tests assert on comprehensibility, not just on
"it rendered".
"""

import re

import pytest

from stock_deal_desk import DealDesk, DeskConfig, RiskConfig
from stock_deal_desk.models import Verdict
from stock_deal_desk.report import render_markdown


@pytest.fixture(scope="module")
def report():
    return render_markdown(DealDesk(provider="fixture").run())


@pytest.fixture(scope="module")
def run():
    return DealDesk(provider="fixture").run()


def test_it_opens_by_saying_what_it_is(report):
    assert report.startswith("# Deal desk")
    assert "idea(s)" in report


def test_synthetic_data_is_called_out_in_words_a_person_reads(report):
    assert "made-up companies" in report
    assert "not a view on any real company" in report


def test_the_market_section_explains_the_regime_in_english(report):
    assert "## What kind of day is it?" in report
    assert "risk budget" in report
    assert re.search(r"Volatility is running at \*\*\d+%\*\* a year", report)


def test_every_bought_name_states_entry_exit_and_the_loss(run, report):
    for r in run.takes:
        assert f"### " in report
        assert r.name in report
    assert report.count("**Buy**") == len(run.takes)
    assert report.count("**Sell if it drops to**") == len(run.takes)
    assert report.count("**Take profit near**") == len(run.takes)


def test_the_loss_is_quoted_in_dollars_and_as_a_share_of_the_account(report):
    assert re.search(r"you would lose \*\*\$[\d,]+\*\* \(\d+\.\d% of the account\)", report)


def test_every_bought_name_has_a_reason_and_a_risk(run, report):
    assert report.count("**Why the desk likes it**") == len(run.takes)
    assert "**What could go wrong**" in report


def test_rejections_are_included_but_collapsed(run, report):
    rejects = [r for r in run.recommendations if r.verdict is Verdict.PASS]
    assert f"Rejected: {len(rejects)} names" in report
    assert "<details>" in report and "</details>" in report


def test_a_glossary_explains_the_jargon_it_could_not_avoid(report):
    assert "What the terms mean" in report
    for term in ("P/E ratio", "Dividend yield", "Payout ratio", "Stop", "Regime"):
        assert f"**{term}**" in report


def test_the_disclaimer_survives(report):
    assert "not investment advice" in report


def test_an_empty_book_says_so_plainly_instead_of_showing_a_blank():
    empty = DealDesk(provider="fixture",
                     config=DeskConfig(risk=RiskConfig(kelly_haircut=0.0))).run()
    out = render_markdown(empty)
    assert "**Nothing today.**" in out
    assert "That is a real answer, not a bug" in out


def test_no_internal_identifiers_leak_into_the_prose(report):
    """Field names and enum reprs are meaningless to the reader."""
    for leak in ("technical_score", "applied_fraction", "expected_log_growth",
                 "Verdict.", "Regime.", "reward_risk", "passed_screen",
                 "dividend_yield", "payout_ratio", "None"):
        assert leak not in report, f"internal identifier {leak!r} leaked into the report"


def test_dollar_figures_are_formatted_with_separators(report):
    assert not re.search(r"\$\d{5,}", report), "found an unseparated 5+ digit dollar figure"
