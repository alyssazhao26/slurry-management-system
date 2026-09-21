-- Store the single employee login timestamp used by the attendance screen.
-- Backfill existing records from the earlier clock-in/creation timestamps.

ALTER TABLE system_import.attendance_records
    ADD COLUMN login_timestamp DATETIME NULL AFTER attendance_date;

UPDATE system_import.attendance_records
SET login_timestamp = COALESCE(clock_in, created_at)
WHERE login_timestamp IS NULL;

-- PIN lookup is on the employee login path, and PINs must remain unique.
CREATE UNIQUE INDEX uq_attendance_employee_pin_code
    ON system_import.attendance_employees (pin_code);
