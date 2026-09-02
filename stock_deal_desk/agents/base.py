"""Common shape for every desk agent.

An agent gets the shared context, does its own work, and publishes typed
findings to the bus. It never returns data to another agent directly and never
reads another agent's private state -- only the bus.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass

from ..bus import MessageBus
from ..config import DeskConfig
from ..providers import DataProvider


@dataclass
class AgentContext:
    provider: DataProvider
    config: DeskConfig
    bus: MessageBus


class Agent(abc.ABC):
    #: Topic this agent publishes to. Declared so the desk can assert coverage.
    topic: str = ""
    name: str = "agent"

    @abc.abstractmethod
    def run(self, ctx: AgentContext) -> None:
        """Do the work and publish findings to ``ctx.bus``."""

    def __repr__(self) -> str:  # pragma: no cover - debugging nicety
        return f"<{type(self).__name__} name={self.name!r} topic={self.topic!r}>"
