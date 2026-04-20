"""Thread-safe metrics: counters + latency histograms.

Exposed via get_stats() for /status endpoint integration. Zero external deps.
"""
import threading
from collections import defaultdict, deque


_lock = threading.Lock()
_counters: dict[str, dict[tuple, int]] = defaultdict(lambda: defaultdict(int))
_latencies: dict[tuple[str, tuple], deque] = defaultdict(lambda: deque(maxlen=100))


def _labels_key(labels: dict | None) -> tuple:
    if not labels:
        return ()
    return tuple(sorted(labels.items()))


def inc(name: str, n: int = 1, labels: dict | None = None) -> None:
    """Increment a counter."""
    key = _labels_key(labels)
    with _lock:
        _counters[name][key] += n


def observe(name: str, value: float, labels: dict | None = None) -> None:
    """Record an observation for latency/size-like metrics.

    Retains the last 100 samples per (name, labels) pair for cheap percentiles.
    """
    key = _labels_key(labels)
    with _lock:
        _latencies[(name, key)].append(value)


def _percentile(values: list[float], p: int) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = int(len(sorted_vals) * p / 100)
    idx = min(idx, len(sorted_vals) - 1)
    return sorted_vals[idx]


def get_stats() -> dict:
    """Snapshot of all metrics. Safe to call from any thread."""
    with _lock:
        counters_snapshot = {
            name: dict(vals) for name, vals in _counters.items()
        }
        latencies_p50 = {
            key: _percentile(list(samples), 50)
            for key, samples in _latencies.items()
        }
        latencies_p95 = {
            key: _percentile(list(samples), 95)
            for key, samples in _latencies.items()
        }
    return {
        "counters": counters_snapshot,
        "latency_p50_ms": latencies_p50,
        "latency_p95_ms": latencies_p95,
    }
