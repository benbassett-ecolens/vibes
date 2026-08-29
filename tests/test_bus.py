from stock_deal_desk.bus import MessageBus
from stock_deal_desk.models import SentimentRead


def test_publish_and_read_round_trip(bus):
    bus.publish("t", 1)
    bus.publish("t", 2)
    assert bus.read("t") == [1, 2]
    assert bus.latest("t") == 2


def test_reading_an_unknown_topic_is_empty_not_an_error(bus):
    assert bus.read("nope") == []
    assert bus.latest("nope") is None


def test_read_returns_a_copy_so_callers_cannot_mutate_the_bus(bus):
    bus.publish("t", 1)
    bus.read("t").append(999)
    assert bus.read("t") == [1]


def test_subscribers_are_notified_on_publish(bus):
    seen = []
    bus.subscribe("t", seen.append)
    bus.publish("t", "hello")
    assert seen == ["hello"]


def test_subscribers_added_later_do_not_see_earlier_messages(bus):
    bus.publish("t", "early")
    seen = []
    bus.subscribe("t", seen.append)
    assert seen == []


def test_by_ticker_indexes_and_last_write_wins(bus):
    bus.publish("s", SentimentRead(ticker="AAA", score=0.1, article_count=1))
    bus.publish("s", SentimentRead(ticker="BBB", score=0.2, article_count=1))
    bus.publish("s", SentimentRead(ticker="AAA", score=0.9, article_count=1))
    indexed = bus.by_ticker("s")
    assert set(indexed) == {"AAA", "BBB"}
    assert indexed["AAA"].score == 0.9


def test_by_ticker_skips_messages_without_a_ticker(bus):
    bus.publish("s", object())
    assert bus.by_ticker("s") == {}


def test_concurrent_publishes_do_not_lose_messages():
    from concurrent.futures import ThreadPoolExecutor
    shared = MessageBus()
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda i: shared.publish("t", i), range(500)))
    assert len(shared.read("t")) == 500
