CREATE SCHEMA IF NOT EXISTS system_import;

CREATE TABLE IF NOT EXISTS system_import.production_records LIKE production_records;
CREATE TABLE IF NOT EXISTS system_import.abnormality_reports LIKE abnormality_reports;

INSERT IGNORE INTO system_import.production_records SELECT * FROM production_records;
INSERT IGNORE INTO system_import.abnormality_reports SELECT * FROM abnormality_reports;

ALTER TABLE system_import.production_records ADD COLUMN custom_fields JSON NULL;
ALTER TABLE system_import.abnormality_reports ADD COLUMN custom_fields JSON NULL;

CREATE TABLE IF NOT EXISTS system_import.field_definitions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    form_key ENUM('production','abnormality') NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    label VARCHAR(120) NOT NULL,
    input_type ENUM('text','number','date','select','textarea') NOT NULL,
    options_json JSON NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_form_field (form_key, field_key)
);

INSERT IGNORE INTO system_import.field_definitions (form_key,field_key,label,input_type,options_json,is_required,display_order) VALUES
('production','operator_note','Operator note','textarea',NULL,FALSE,100),
('production','work_order','Work order','text',NULL,FALSE,110),
('abnormality','reason_code','Reason code','select','["Equipment","Quality","Material","Personnel","Process","Other"]',FALSE,100),
('abnormality','follow_up_note','Follow-up note','textarea',NULL,FALSE,110);
