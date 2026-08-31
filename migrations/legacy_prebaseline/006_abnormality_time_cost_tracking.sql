ALTER TABLE system_import.abnormality_reports
    ADD COLUMN start_time TIME NULL AFTER event_date,
    ADD COLUMN end_time TIME NULL AFTER start_time,
    ADD COLUMN is_resolved ENUM('yes', 'no') NOT NULL DEFAULT 'no' AFTER state,
    ADD COLUMN effective_time_cost ENUM('yes', 'no') NULL AFTER is_resolved,
    ADD COLUMN cost_failure_types JSON NULL AFTER effective_time_cost,
    ADD COLUMN potential_cost DECIMAL(14, 2) NULL AFTER cost_failure_types;

CREATE INDEX idx_abnormality_ongoing
    ON system_import.abnormality_reports (is_resolved, event_date, created_at);
