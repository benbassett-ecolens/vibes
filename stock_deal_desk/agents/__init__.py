"""The four desk agents."""

from .base import Agent, AgentContext
from .market_watch import MarketWatchAgent
from .news_sentiment import NewsSentimentAgent
from .risk_manager import RiskManagerAgent
from .setup_hunter import SetupHunterAgent

__all__ = [
    "Agent", "AgentContext",
    "MarketWatchAgent", "SetupHunterAgent", "NewsSentimentAgent", "RiskManagerAgent",
]
