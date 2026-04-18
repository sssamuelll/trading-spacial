import pytest
from datetime import datetime, timezone
from auto_tune import calculate_periods, generate_combos, should_recommend, GRID


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


class TestGridCombos:
    def test_combo_count(self):
        combos = generate_combos()
        assert len(combos) == 105

    def test_combo_keys(self):
        combos = generate_combos()
        for combo in combos:
            assert "atr_sl_mult" in combo
            assert "atr_tp_mult" in combo
            assert "atr_be_mult" in combo


class TestShouldRecommend:
    def test_rejects_below_improvement(self):
        assert should_recommend(10000, 11000, 60, 1.2) is False  # +10% < 15%

    def test_accepts_above_improvement(self):
        assert should_recommend(10000, 12000, 60, 1.2) is True  # +20%

    def test_rejects_insufficient_trades(self):
        assert should_recommend(10000, 12000, 30, 1.2) is False  # 30 < 50

    def test_accepts_sufficient_trades(self):
        assert should_recommend(10000, 12000, 55, 1.2) is True

    def test_rejects_low_pf(self):
        assert should_recommend(10000, 12000, 60, 1.05) is False  # PF < 1.1

    def test_accepts_good_pf(self):
        assert should_recommend(10000, 12000, 60, 1.15) is True

    def test_rejects_negative_with_bad_pf(self):
        assert should_recommend(-5000, -4000, 60, 0.9) is False

    def test_handles_zero_current(self):
        assert should_recommend(0, 2000, 60, 1.2) is True
