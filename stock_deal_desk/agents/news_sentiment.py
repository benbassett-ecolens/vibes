"""Agent 3 of 4 -- reads the news and scores sentiment.

This is a deterministic lexicon scorer, on purpose: it is reproducible, it is
testable, and it never hallucinates a catalyst that was not in the headline.
It weights each headline by recency (two-week half-life) and by how much the
source deserves to move a position (a wire report outranks a company press
release, which is marketing).

Its more important job is the second one: flagging *landmines*. A cheap stock
with a high P/E and a fat yield is exactly the profile where an SEC
investigation or a going-concern paragraph is hiding, and the risk agent
treats a landmine as an outright veto rather than a score deduction.

To upgrade this agent, replace ``_score_headline`` with a model call; the
Setup/SentimentRead contract around it does not change.
"""

from __future__ import annotations

from datetime import date, datetime

from ..bus import TOPIC_SENTIMENT
from ..models import SentimentRead
from .base import Agent, AgentContext

HALF_LIFE_DAYS = 14.0

SOURCE_WEIGHT = {
    "reuters": 1.0, "bloomberg": 1.0, "wsj": 1.0, "ft": 1.0,
    "barron's": 0.8, "barrons": 0.8, "fiercepharma": 0.7, "yahoo": 0.6,
    "prnewswire": 0.35, "businesswire": 0.35, "globenewswire": 0.35,
}
DEFAULT_SOURCE_WEIGHT = 0.6

# phrase -> polarity contribution
BULLISH = {
    "raises guidance": 1.0, "raises full-year": 1.0, "raises dividend": 0.9,
    "beats": 0.7, "tops estimates": 0.7, "record": 0.6, "upgrade": 0.8,
    "buyback": 0.6, "wins approval": 0.7, "signs": 0.5, "contract": 0.5,
    "recover": 0.6, "rebounds": 0.6, "narrow": 0.4, "stabilize": 0.4,
    "synergy": 0.4, "milestone": 0.4, "reaffirms": 0.3, "rallies": 0.5,
    "beat": 0.6, "expansion": 0.4, "ramps": 0.4, "advance sales": 0.5,
}
BEARISH = {
    "misses": -0.8, "cuts guidance": -1.0, "guidance cut": -1.0,
    "downgrade": -0.8, "downgrades": -0.8, "losses": -0.5, "loss": -0.4,
    "falls short": -0.7, "disappoints": -0.7, "accelerate": -0.3,
    "pressure": -0.4, "pressured": -0.4, "weak": -0.5, "cuts capacity": -0.6,
    "closes": -0.3, "resigns": -0.7, "slips": -0.4, "widen": -0.4,
    "dilutive": -0.9, "lagging": -0.4, "frustration": -0.4, "explores asset sales": -0.5,
    "trims": -0.3, "volatility": -0.3, "destocking": -0.3,
}

# Phrases that stop the desk cold, regardless of how good the chart looks.
LANDMINES = {
    "going concern": "going-concern warning",
    "investigation": "regulatory investigation",
    "sec investigation": "SEC investigation",
    "fraud": "fraud allegation",
    "short seller": "short-seller campaign",
    "dividend cut": "dividend cut",
    "cuts dividend": "dividend cut",
    "cut dividend": "dividend cut",
    "halves distribution": "distribution cut",
    "restatement": "financial restatement",
    "material weakness": "material control weakness",
    "control weakness": "material control weakness",
    "delisting": "delisting risk",
    "bankruptcy": "bankruptcy risk",
    "chapter 11": "bankruptcy filing",
    "to junk": "downgrade to junk",
    "cfo resigns": "CFO departure",
    "equity offering": "dilutive equity offering",
}


class NewsSentimentAgent(Agent):
    topic = TOPIC_SENTIMENT
    name = "news-sentiment"

    def run(self, ctx: AgentContext) -> None:
        reference = self._reference_date(ctx)
        for ticker in ctx.provider.universe():
            ctx.bus.publish(self.topic, self._read(ctx, ticker, reference))

    @staticmethod
    def _reference_date(ctx: AgentContext) -> date:
        as_of = getattr(ctx.provider, "as_of", None)
        if isinstance(as_of, str):
            try:
                return datetime.strptime(as_of, "%Y-%m-%d").date()
            except ValueError:
                pass
        return date.today()

    def _read(self, ctx: AgentContext, ticker: str, reference: date) -> SentimentRead:
        headlines = ctx.provider.headlines(ticker)
        if not headlines:
            return SentimentRead(ticker=ticker, score=0.0, article_count=0)

        weighted_sum = 0.0
        weight_total = 0.0
        catalysts: list[str] = []
        landmines: list[str] = []

        for headline in headlines:
            title = headline.title.lower()
            polarity, hits = self._score_headline(title)
            weight = self._recency(headline.date, reference) * self._source(headline.source)
            weighted_sum += polarity * weight
            weight_total += weight

            for phrase, label in LANDMINES.items():
                if phrase in title and label not in landmines:
                    landmines.append(label)
            if polarity > 0.45 and hits:
                catalysts.append(f"{headline.title} ({headline.source})")

        score = weighted_sum / weight_total if weight_total else 0.0
        return SentimentRead(
            ticker=ticker,
            score=round(max(-1.0, min(1.0, score)), 4),
            article_count=len(headlines),
            catalysts=catalysts[:3],
            landmines=landmines,
        )

    @staticmethod
    def _score_headline(title: str) -> tuple[float, int]:
        """Sum matched lexicon phrases, then squash into -1..+1."""
        total = 0.0
        hits = 0
        for phrase, value in BULLISH.items():
            if phrase in title:
                total += value
                hits += 1
        for phrase, value in BEARISH.items():
            if phrase in title:
                total += value
                hits += 1
        if not hits:
            return 0.0, 0
        # Average rather than sum so a wordy headline is not double-counted.
        return max(-1.0, min(1.0, total / max(1, hits))), hits

    @staticmethod
    def _recency(day: str, reference: date) -> float:
        try:
            parsed = datetime.strptime(day[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return 0.5
        age = max(0, (reference - parsed).days)
        return 0.5 ** (age / HALF_LIFE_DAYS)

    @staticmethod
    def _source(source: str) -> float:
        return SOURCE_WEIGHT.get((source or "").strip().lower(), DEFAULT_SOURCE_WEIGHT)
