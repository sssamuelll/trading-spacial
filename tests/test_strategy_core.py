"""Tests for strategy.core.evaluate_signal — parity with btc_scanner.scan() (#186 A1)."""
from __future__ import annotations

import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest


# ─────────────────────────────────────────────────────────────────────────────
#  Commit A — SignalDecision dataclass tests
# ─────────────────────────────────────────────────────────────────────────────


def test_signal_decision_dataclass_constructs():
    from strategy.core import SignalDecision
    d = SignalDecision()
    assert d.direction == "NONE"
    assert d.score == 0
    assert d.score_label == ""
    assert d.is_signal is False
    assert d.is_setup is False
    assert d.entry_price is None
    assert d.sl_price is None
    assert d.tp_price is None
    assert d.reasons == {}
    assert d.indicators == {}
    assert d.estado == ""


def test_signal_decision_fields_populated():
    from strategy.core import SignalDecision
    d = SignalDecision(
        direction="LONG",
        score=6,
        score_label="PREMIUM",
        is_signal=True,
        entry_price=50_000.0,
        sl_price=49_000.0,
        tp_price=55_000.0,
    )
    assert d.direction == "LONG"
    assert d.is_signal is True
    assert d.entry_price == 50_000.0
    assert d.sl_price == 49_000.0
    assert d.tp_price == 55_000.0


def test_evaluate_signal_stub_returns_decision_on_empty_df():
    """With insufficient data the function should return a NONE decision — not raise."""
    from strategy.core import evaluate_signal
    empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    decision = evaluate_signal(
        df1h=empty,
        df4h=empty,
        df5m=empty,
        df1d=empty,
        symbol="BTCUSDT",
        cfg={},
        regime={"regime": "NEUTRAL", "score": 50, "details": {}},
        health_state="NORMAL",
        now=datetime(2026, 4, 23, tzinfo=timezone.utc),
    )
    assert decision.direction == "NONE"
    assert decision.is_signal is False
