#!/usr/bin/env python3
"""Generate data/snapshot.json -- the deterministic, SYNTHETIC desk fixture.

Everything this writes is made up. The price paths come from a seeded
geometric random walk and the fundamentals are hand-chosen to exercise every
branch of the screen and the risk agent (names that pass, names vetoed for
payout, for liquidity, for reward:risk, for a news landmine).

Ticker symbols are real so the output reads naturally, but NONE of these
numbers describe the real companies. Regenerate with:

    python tools/make_fixture.py
"""

from __future__ import annotations

import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "snapshot.json"
AS_OF = date(2026, 8, 28)
N_BARS = 400
SEED = 20260828

# ticker: (name, sector, end_price, pe, div_yield, payout, mcap_musd, shape, vol)
SECURITIES = {
    # --- names built to pass the screen (high P/E, low price, pays a dividend)
    "F":     ("Ford Motor",            "Consumer Cyclical", 11.42, 34.6, 0.052, 0.94, 45_800, "recovery", 0.34),
    "KEY":   ("KeyCorp",               "Financial Services", 17.85, 28.9, 0.046, 0.88, 16_900, "uptrend",  0.29),
    "HBAN":  ("Huntington Bancshares", "Financial Services", 15.31, 26.4, 0.041, 0.72, 22_300, "uptrend",  0.27),
    "VTRS":  ("Viatris",               "Healthcare",          9.88, 41.2, 0.049, 1.05,  11_700, "base",     0.31),
    "AMCR":  ("Amcor",                 "Consumer Defensive", 10.24, 31.7, 0.048, 0.92, 14_800, "recovery", 0.24),
    "KMI":   ("Kinder Morgan",         "Energy",             24.60, 27.3, 0.047, 0.98, 54_600, "uptrend",  0.25),
    "RF":    ("Regions Financial",     "Financial Services", 22.14, 25.8, 0.043, 0.66, 20_100, "uptrend",  0.28),
    "SWN":   ("Southwestern Energy",   "Energy",              7.62, 52.4, 0.021, 0.68,  8_400, "recovery", 0.44),
    "NOK":   ("Nokia",                 "Technology",          5.31, 38.9, 0.031, 0.83, 29_400, "base",     0.33),
    "PARA":  ("Paramount Global",      "Communication",      12.07, 44.1, 0.018, 0.42,  8_100, "downtrend", 0.47),

    # --- fail the screen for an instructive reason
    "T":     ("AT&T",                  "Communication",      21.90, 13.4, 0.061, 0.71, 156_000, "uptrend",  0.21),  # P/E too low
    "PFE":   ("Pfizer",                "Healthcare",         26.85, 18.2, 0.058, 0.94, 152_000, "base",     0.23),  # P/E low, price high
    "BAC":   ("Bank of America",       "Financial Services", 44.20, 13.9, 0.024, 0.31, 335_000, "uptrend",  0.26),  # price too high
    "SIRI":  ("Sirius XM",             "Communication",       2.41, 61.0, 0.038, 1.44,   9_200, "downtrend", 0.52), # price under floor
    "AAL":   ("American Airlines",     "Industrials",        13.16, 29.4, 0.000, None,   8_600, "downtrend", 0.49), # no dividend
    "SNAP":  ("Snap Inc",              "Communication",       9.74, None, 0.000, None,  16_200, "base",     0.55),  # no earnings, no P/E
    "PLUG":  ("Plug Power",            "Industrials",         2.08, None, 0.000, None,   1_900, "downtrend", 0.86), # unprofitable

    # --- pass the screen but the risk agent should have something to say
    "MPW":   ("Medical Properties",    "Real Estate",         6.43, 33.8, 0.089, 1.62,   3_900, "recovery", 0.51), # payout > cap
    "AGNC":  ("AGNC Investment",       "Real Estate",         9.55, 29.6, 0.147, 1.38,   8_800, "base",     0.29), # payout > cap
    "NYCB":  ("Flagstar Financial",    "Financial Services",  11.72, 47.9, 0.008, 0.55,   4_800, "downtrend", 0.58), # landmine news
    "IEP":   ("Icahn Enterprises",     "Industrials",          8.31, 36.2, 0.096, 1.90,   4_200, "downtrend", 0.46), # payout + trend
    "WBA":   ("Walgreens Boots",       "Healthcare",           11.05, 39.5, 0.045, 1.18,   9_500, "downtrend", 0.44),
    "CFG":   ("Citizens Financial",    "Financial Services",  23.40, 26.1, 0.042, 0.70,  10_600, "uptrend",  0.30),
    "CCL":   ("Carnival Corp",         "Consumer Cyclical",   18.72, 31.5, 0.000, None,  23_800, "uptrend",  0.42),
    "THIN":  ("Thinly Traded Co",      "Industrials",          6.15, 33.0, 0.036, 0.61,     140, "base",     0.38), # liquidity veto
}

BENCHMARK = ("SPY", "S&P 500 ETF", "Index", 611.40, "uptrend", 0.14)

HEADLINES = {
    "F":    [("Reuters", "Ford raises full-year guidance as truck margins recover", -0),
             ("Bloomberg", "Ford EV losses narrow for a third straight quarter", -1),
             ("Barron's", "Analyst upgrades Ford on improving free cash flow", -3)],
    "KEY":  [("WSJ", "KeyCorp beats on net interest income, reaffirms dividend", -2),
             ("Reuters", "Regional bank deposits stabilize across the sector", -5)],
    "HBAN": [("Bloomberg", "Huntington posts record fee income, credit costs contained", -1),
             ("Reuters", "Huntington announces buyback expansion", -6)],
    "VTRS": [("Reuters", "Viatris wins approval for two generic launches", -2),
             ("FiercePharma", "Viatris guidance cut on European pricing pressure", -9)],
    "AMCR": [("Reuters", "Amcor synergy targets raised after integration milestone", -3),
             ("Bloomberg", "Packaging demand rebounds from destocking trough", -7)],
    "KMI":  [("Reuters", "Kinder Morgan signs long-term LNG transport contract", -2),
             ("WSJ", "Pipeline operators benefit from data-center power demand", -4)],
    "RF":   [("Bloomberg", "Regions Financial raises dividend 5%", -3)],
    "SWN":  [("Reuters", "Natural gas rallies on export capacity additions", -1),
             ("Bloomberg", "Southwestern trims capex, prioritizes debt paydown", -8)],
    "NOK":  [("Reuters", "Nokia signs 5G contract with a major European carrier", -4),
             ("FT", "Nokia margins pressured by competitive pricing in India", -11)],
    "PARA": [("WSJ", "Paramount explores asset sales amid streaming losses", -2),
             ("Reuters", "Paramount cuts dividend to preserve cash", -14),
             ("Bloomberg", "Ratings agency downgrades Paramount to junk", -6)],
    "T":    [("Reuters", "AT&T reaffirms free cash flow outlook", -3)],
    "PFE":  [("Reuters", "Pfizer pipeline readout disappoints in oncology", -5)],
    "BAC":  [("Bloomberg", "Bank of America trading revenue tops estimates", -2)],
    "SIRI": [("Reuters", "Sirius XM subscriber losses accelerate", -3)],
    "AAL":  [("WSJ", "American Airlines cuts capacity on weak domestic demand", -4)],
    "SNAP": [("Reuters", "Snap daily active users beat, monetization still lagging", -3)],
    "PLUG": [("Reuters", "Plug Power going concern warning repeated in filing", -5),
             ("Bloomberg", "Plug Power announces dilutive equity offering", -12)],
    "MPW":  [("Reuters", "Medical Properties tenant misses rent payment again", -4),
             ("Bloomberg", "MPW asset sales fall short of deleveraging target", -10)],
    "AGNC": [("Reuters", "AGNC book value slips as spreads widen", -6),
             ("Barron's", "Mortgage REITs face renewed rate volatility", -2)],
    "NYCB": [("WSJ", "Flagstar discloses SEC investigation into loan disclosures", -3),
             ("Reuters", "Flagstar internal control weakness flagged by auditor", -8),
             ("Bloomberg", "Flagstar CFO resigns", -15)],
    "IEP":  [("Bloomberg", "Icahn Enterprises halves distribution again", -7),
             ("Reuters", "Short seller renews fraud allegations against IEP", -20)],
    "WBA":  [("WSJ", "Walgreens closes 1,200 stores in turnaround push", -6),
             ("Reuters", "Walgreens dividend cut deepens shareholder frustration", -18)],
    "CFG":  [("Reuters", "Citizens Financial private bank ramps deposits", -4)],
    "CCL":  [("Bloomberg", "Carnival books record advance sales for next season", -2)],
    "THIN": [("PRNewswire", "Thinly Traded Co reports steady quarterly results", -5)],
}


def make_path(rng: random.Random, end_price: float, shape: str, vol: float, n: int) -> list[float]:
    """A seeded random walk with a shape-dependent drift, rescaled to end_price."""
    daily_vol = vol / math.sqrt(252)
    drift_by_shape = {
        "uptrend":   0.0009,
        "base":      0.0001,
        "downtrend": -0.0011,
        "recovery":  0.0,     # handled piecewise below
    }
    path = [100.0]
    for i in range(1, n):
        if shape == "recovery":
            # first 60% of the window sells off, the last 40% turns up.
            mu = -0.0016 if i < n * 0.6 else 0.0022
        else:
            mu = drift_by_shape[shape]
        shock = rng.gauss(0.0, daily_vol)
        path.append(max(0.05, path[-1] * math.exp(mu + shock)))
    scale = end_price / path[-1]
    return [p * scale for p in path]


def make_bars(rng: random.Random, path: list[float], shares_out: float, price: float) -> list[dict]:
    """Wrap a close path in plausible OHLC and volume."""
    bars = []
    day = AS_OF - timedelta(days=int(len(path) * 1.42))
    base_volume = max(2.0e5, shares_out * 0.004)
    for i, close in enumerate(path):
        while day.weekday() >= 5:
            day += timedelta(days=1)
        prev = path[i - 1] if i else close
        intraday = abs(rng.gauss(0.0, 0.011)) + 0.004
        high = max(prev, close) * (1.0 + intraday)
        low = min(prev, close) * (1.0 - intraday)
        open_ = low + (high - low) * rng.random()
        volume = base_volume * (0.6 + 1.2 * rng.random())
        bars.append({
            "date": day.isoformat(),
            "open": round(open_, 4),
            "high": round(high, 4),
            "low": round(low, 4),
            "close": round(close, 4),
            "volume": round(volume, 0),
        })
        day += timedelta(days=1)
    return bars


def main() -> None:
    rng = random.Random(SEED)
    securities: dict[str, dict] = {}

    for ticker, (name, sector, price, pe, dy, payout, mcap_musd, shape, vol) in SECURITIES.items():
        sec_rng = random.Random(f"{SEED}:{ticker}")
        path = make_path(sec_rng, price, shape, vol, N_BARS)
        market_cap = mcap_musd * 1_000_000.0
        shares_out = market_cap / price
        bars = make_bars(sec_rng, path, shares_out, price)
        avg_dollar_volume = sum(b["volume"] * b["close"] for b in bars[-30:]) / 30.0
        securities[ticker] = {
            "fundamentals": {
                "name": name,
                "sector": sector,
                "price": round(path[-1], 4),
                "pe_trailing": pe,
                "pe_forward": round(pe * 0.86, 2) if pe else None,
                "eps_trailing": round(price / pe, 4) if pe else None,
                "dividend_yield": dy,
                "payout_ratio": payout,
                "market_cap": market_cap,
                "shares_out": shares_out,
                "avg_dollar_volume": avg_dollar_volume,
            },
            "bars": bars,
            "headlines": [
                {"date": (AS_OF + timedelta(days=offset)).isoformat(),
                 "source": source, "title": title}
                for source, title, offset in HEADLINES.get(ticker, [])
            ],
        }

    bt, bname, bsector, bprice, bshape, bvol = BENCHMARK
    b_rng = random.Random(f"{SEED}:{bt}")
    b_path = make_path(b_rng, bprice, bshape, bvol, N_BARS)
    securities[bt] = {"bars": make_bars(b_rng, b_path, 1e9, bprice), "headlines": []}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as fh:
        json.dump({
            "_warning": "SYNTHETIC DATA. Generated by tools/make_fixture.py from a "
                        "seeded RNG. Ticker symbols are real; every number here is "
                        "invented and describes no real company.",
            "synthetic": True,
            "as_of": AS_OF.isoformat(),
            "seed": SEED,
            "benchmark": bt,
            "securities": securities,
        }, fh, separators=(",", ":"))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(securities)} securities)")


if __name__ == "__main__":
    main()
