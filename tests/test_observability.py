"""Tests for the kill switch decision log (Phase 1 of #187)."""
import json

import pytest


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    import btc_api
    db_path = str(tmp_path / "signals.db")
    monkeypatch.setattr(btc_api, "DB_FILE", db_path)
    if hasattr(btc_api, "_db_conn"):
        delattr(btc_api, "_db_conn")
    btc_api.init_db()
    yield db_path


def test_record_decision_inserts_row(tmp_db):
    from observability import record_decision, query_decisions
    record_decision(
        symbol="BTCUSDT",
        engine="v1",
        per_symbol_tier="NORMAL",
        portfolio_tier="NORMAL",
        size_factor=1.0,
        skip=False,
        reasons={"wr_rolling_20": 0.35},
        scan_id=None,
        slider_value=None,
        velocity_active=False,
    )
    rows = query_decisions()
    assert len(rows) == 1
    assert rows[0]["symbol"] == "BTCUSDT"
    assert rows[0]["engine"] == "v1"
    assert rows[0]["per_symbol_tier"] == "NORMAL"
    assert rows[0]["size_factor"] == 1.0
    assert rows[0]["skip"] is False
    assert json.loads(rows[0]["reasons_json"]) == {"wr_rolling_20": 0.35}


def test_query_filters_by_symbol(tmp_db):
    from observability import record_decision, query_decisions
    record_decision(symbol="BTCUSDT", engine="v1", per_symbol_tier="NORMAL",
                    portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                    reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    record_decision(symbol="ETHUSDT", engine="v1", per_symbol_tier="ALERT",
                    portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                    reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    rows = query_decisions(symbol="ETHUSDT")
    assert len(rows) == 1
    assert rows[0]["symbol"] == "ETHUSDT"


def test_query_filters_by_engine(tmp_db):
    from observability import record_decision, query_decisions
    record_decision(symbol="BTCUSDT", engine="v1", per_symbol_tier="NORMAL",
                    portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                    reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    record_decision(symbol="BTCUSDT", engine="v2_shadow", per_symbol_tier="NORMAL",
                    portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                    reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    rows = query_decisions(engine="v1")
    assert len(rows) == 1
    assert rows[0]["engine"] == "v1"


def test_query_ordered_by_ts_desc(tmp_db):
    from observability import record_decision, query_decisions
    record_decision(symbol="A", engine="v1", per_symbol_tier="NORMAL",
                    portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                    reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    record_decision(symbol="B", engine="v1", per_symbol_tier="NORMAL",
                    portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                    reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    rows = query_decisions()
    assert rows[0]["symbol"] == "B"
    assert rows[1]["symbol"] == "A"


def test_query_respects_limit(tmp_db):
    from observability import record_decision, query_decisions
    for i in range(5):
        record_decision(symbol=f"SYM{i}", engine="v1", per_symbol_tier="NORMAL",
                        portfolio_tier="NORMAL", size_factor=1.0, skip=False,
                        reasons={}, scan_id=None, slider_value=None, velocity_active=False)
    rows = query_decisions(limit=3)
    assert len(rows) == 3
