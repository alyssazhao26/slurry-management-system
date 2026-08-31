CREATE INDEX idx_production_created_at ON system_import.production_records (created_at);
CREATE INDEX idx_production_date_machine ON system_import.production_records (record_date, machine_code);
CREATE INDEX idx_abnormality_created_at ON system_import.abnormality_reports (created_at);
CREATE INDEX idx_abnormality_open_tracker ON system_import.abnormality_reports (state, target_finish_date, created_at);
