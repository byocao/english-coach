-- VIP accounts get weekly allowances: quota_week is the Monday (Vietnam time, YYYY-MM-DD) that
-- lessons_used / grades_used count from. A VIP's counters start from zero when a new week begins.
ALTER TABLE users ADD COLUMN quota_week TEXT;
