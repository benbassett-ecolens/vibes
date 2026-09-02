"""A tiny thread-safe blackboard the agents publish to and read from.

The four agents do not call each other. They publish typed findings onto this
bus under a topic, and the desk reads the blackboard once every agent has run.
That keeps the swarm loosely coupled: you can add a fifth agent (options flow,
insider buying, short interest) without touching the existing four.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Any, Callable, Iterator


class MessageBus:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._topics: dict[str, list[Any]] = defaultdict(list)
        self._subscribers: dict[str, list[Callable[[Any], None]]] = defaultdict(list)

    def publish(self, topic: str, message: Any) -> None:
        with self._lock:
            self._topics[topic].append(message)
            listeners = list(self._subscribers.get(topic, ()))
        # Fan out outside the lock so a slow subscriber cannot stall publishers.
        for listener in listeners:
            listener(message)

    def publish_many(self, topic: str, messages: list[Any]) -> None:
        for message in messages:
            self.publish(topic, message)

    def subscribe(self, topic: str, listener: Callable[[Any], None]) -> None:
        with self._lock:
            self._subscribers[topic].append(listener)

    def read(self, topic: str) -> list[Any]:
        with self._lock:
            return list(self._topics.get(topic, ()))

    def latest(self, topic: str) -> Any | None:
        with self._lock:
            messages = self._topics.get(topic)
            return messages[-1] if messages else None

    def by_ticker(self, topic: str) -> dict[str, Any]:
        """Index a topic by the ``ticker`` field, last write winning."""
        return {m.ticker: m for m in self.read(topic) if hasattr(m, "ticker")}

    def topics(self) -> Iterator[str]:
        with self._lock:
            return iter(sorted(self._topics))

    def clear(self) -> None:
        with self._lock:
            self._topics.clear()


# Topic names, in one place so a typo is an ImportError not a silent miss.
TOPIC_MARKET = "market.view"
TOPIC_SETUP = "setup.candidate"
TOPIC_SENTIMENT = "news.sentiment"
TOPIC_RISK = "risk.decision"
