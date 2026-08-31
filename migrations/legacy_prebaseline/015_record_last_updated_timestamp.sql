ALTER TABLE system_import.production_records
    ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE system_import.abnormality_reports
    ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

UPDATE system_import.production_records SET updated_at = created_at;
UPDATE system_import.abnormality_reports SET updated_at = created_at;
