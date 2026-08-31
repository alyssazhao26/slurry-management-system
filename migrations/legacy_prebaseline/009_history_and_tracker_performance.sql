-- Keeps unresolved-event and daily manager queries fast as history grows.
CREATE INDEX idx_abnormality_ongoing_time
    ON system_import.abnormality_reports (is_resolved, event_date, start_time, created_at);

CREATE INDEX idx_abnormality_event_date_state
    ON system_import.abnormality_reports (event_date, state);
