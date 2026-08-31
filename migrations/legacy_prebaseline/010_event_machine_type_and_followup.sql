ALTER TABLE system_import.abnormality_reports
    ADD COLUMN machine_type ENUM('semi', 'auto') NULL AFTER machine_code;

UPDATE system_import.field_definitions
SET is_active = FALSE
WHERE form_key = 'abnormality' AND field_key = 'follow_up_note';
