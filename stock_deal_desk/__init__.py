"""stock_deal_desk -- a four-agent equity research desk.

    from stock_deal_desk import DealDesk
    run = DealDesk(provider="fixture").run()
    for rec in run.takes:
        print(rec.ticker, rec.risk.shares, rec.risk.position_dollars)

This is an educational project. It is not investment advice, it has not been
backtested, and its sizing math assumes inputs it cannot actually verify.
"""

from .config import DeskConfig, MergeWeights, RiskConfig, ScreenConfig
from .desk import DealDesk, DeskRun
from .models import Recommendation, Regime, Verdict

__version__ = "0.1.0"
__all__ = [
    "DealDesk", "DeskRun", "DeskConfig", "ScreenConfig", "RiskConfig",
    "MergeWeights", "Recommendation", "Regime", "Verdict",
]
