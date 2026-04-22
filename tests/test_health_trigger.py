"""Position-close trigger: closing a position must invoke evaluate_and_record
for that symbol."""
from unittest.mock import patch, MagicMock

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


def test_trigger_health_evaluation_calls_evaluate_and_record(tmp_db):
    """The trigger wraps evaluate_and_record in error-suppression so DB errors
    don't crash the position-close path."""
    from health import trigger_health_evaluation
    with patch("health.evaluate_and_record") as mock_eval:
        trigger_health_evaluation("BTCUSDT", {"kill_switch": {"enabled": True}})
    mock_eval.assert_called_once_with("BTCUSDT", {"kill_switch": {"enabled": True}})


def test_trigger_swallows_exceptions(tmp_db, caplog):
    """If evaluate_and_record raises, the trigger logs and returns None."""
    import logging
    from health import trigger_health_evaluation
    with patch("health.evaluate_and_record", side_effect=RuntimeError("boom")):
        with caplog.at_level(logging.ERROR, logger="health"):
            result = trigger_health_evaluation("BTC", {"kill_switch": {"enabled": True}})
    assert result is None
    assert any("boom" in r.message for r in caplog.records)


def test_trigger_respects_disabled_kill_switch(tmp_db):
    """If kill_switch.enabled=False, trigger is a no-op (does not call evaluate)."""
    from health import trigger_health_evaluation
    with patch("health.evaluate_and_record") as mock_eval:
        trigger_health_evaluation("BTC", {"kill_switch": {"enabled": False}})
    assert mock_eval.call_count == 0
