-- Add shift-specific task slots without changing the immutable baseline.
-- Existing task rows become Day-shift rows. Slitting uses Day/Night, while
-- Slurry also uses the two selectable daytime schedules.

ALTER TABLE system_import.daily_tasks
    DROP PRIMARY KEY,
    ADD COLUMN shift_name
        ENUM('Day', 'Night', 'Day 08-20', 'Day 08-17')
        NOT NULL DEFAULT 'Day'
        AFTER record_date,
    ADD PRIMARY KEY (record_date, shift_name);
