import pytest
from datetime import datetime, timezone
from auto_tune import calculate_periods, GRID


class TestCalculatePeriods:
    def test_periods_from_fixed_date(self):
        today = datetime(2026, 4, 18, tzinfo=timezone.utc)
        train_start, train_end, val_start, val_end = calculate_periods(today)
        assert train_start.year == 2025
        assert train_start.month == 1
        assert train_end.year == 2026
        assert train_end.month == 1
        assert val_start == train_end
        assert val_end == today

    def test_periods_lengths(self):
        today = datetime(2026, 4, 18, tzinfo=timezone.utc)
        train_start, train_end, val_start, val_end = calculate_periods(today)
        train_days = (train_end - train_start).days
        val_days = (val_end - val_start).days
        assert 350 <= train_days <= 370
        assert 85 <= val_days <= 95
