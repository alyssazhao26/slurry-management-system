-- GNEM consolidated baseline for a new MySQL 8 installation.
-- Existing production installations must keep their original migration history;
-- this file is intended for clean deployments from this repository.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_id BIGINT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT NOT NULL,
    action VARCHAR(80) NOT NULL,
    details_json JSON NOT NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_entity (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS exceptions_queue (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    source_type ENUM('production', 'abnormality') NOT NULL,
    source_id BIGINT NOT NULL,
    severity ENUM('medium', 'high') NOT NULL,
    summary TEXT NOT NULL,
    evidence_json JSON NOT NULL,
    status ENUM('open', 'assigned', 'resolved', 'overridden') NOT NULL DEFAULT 'open',
    assigned_to BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    INDEX idx_exception_status (status, severity)
);

CREATE SCHEMA IF NOT EXISTS system_import
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS system_import.production_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    record_date DATE NOT NULL,
    shift_name VARCHAR(50) NOT NULL,
    machine_code VARCHAR(50) NOT NULL,
    formula_code VARCHAR(50) NOT NULL,
    batch_number VARCHAR(80) NOT NULL,
    planned_quantity DECIMAL(14, 2) NOT NULL,
    actual_quantity DECIMAL(14, 2) NOT NULL,
    qualified_quantity DECIMAL(14, 2) NULL,
    qualified_pending BOOLEAN NOT NULL DEFAULT FALSE,
    achievement_rate DECIMAL(10, 4) NULL,
    qualified_rate DECIMAL(10, 4) NULL,
    notes TEXT NULL,
    state ENUM('submitted', 'approved', 'correction_requested') NOT NULL DEFAULT 'submitted',
    row_version INT NOT NULL DEFAULT 1,
    created_by BIGINT NULL,
    custom_fields JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_production_quantities CHECK (
        planned_quantity >= 0
        AND actual_quantity >= 0
        AND (qualified_quantity IS NULL OR qualified_quantity >= 0)
        AND (qualified_quantity IS NULL OR qualified_quantity <= actual_quantity)
    ),
    UNIQUE KEY uq_production_entry (record_date, shift_name, machine_code, batch_number),
    INDEX idx_production_created_at (created_at),
    INDEX idx_production_date_machine (record_date, machine_code)
);

CREATE TABLE IF NOT EXISTS system_import.abnormality_reports (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_date DATE NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    shift_name VARCHAR(50) NOT NULL,
    machine_code VARCHAR(50) NOT NULL,
    machine_type ENUM('semi', 'auto') NULL,
    event_type VARCHAR(80) NOT NULL,
    severity ENUM('normal', 'low', 'medium', 'high') NOT NULL,
    duration_minutes INT NOT NULL,
    description TEXT NULL,
    immediate_action TEXT NULL,
    state ENUM('open', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    is_resolved ENUM('yes', 'no') NOT NULL DEFAULT 'no',
    effective_time_cost ENUM('yes', 'no') NULL,
    cost_failure_types JSON NULL,
    potential_cost DECIMAL(14, 2) NULL,
    responsible_person VARCHAR(120) NULL,
    target_finish_date DATE NULL,
    solution_provided TEXT NULL,
    actual_finish_date DATE NULL,
    effectiveness ENUM('pending', 'effective', 'not_effective') NOT NULL DEFAULT 'pending',
    row_version INT NOT NULL DEFAULT 1,
    reported_by BIGINT NULL,
    custom_fields JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_abnormality_duration CHECK (duration_minutes >= 0),
    INDEX idx_abnormality_created_at (created_at),
    INDEX idx_abnormality_open_tracker (state, target_finish_date, created_at),
    INDEX idx_abnormality_ongoing_time (is_resolved, event_date, start_time, created_at),
    INDEX idx_abnormality_event_date_state (event_date, state)
);

CREATE TABLE IF NOT EXISTS system_import.field_definitions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    form_key ENUM('production', 'abnormality') NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    label VARCHAR(120) NOT NULL,
    input_type ENUM('text', 'number', 'date', 'select', 'textarea') NOT NULL,
    options_json JSON NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_form_field (form_key, field_key)
);

CREATE TABLE IF NOT EXISTS system_import.standard_field_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    form_key ENUM('production', 'abnormality') NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    label VARCHAR(160) NOT NULL,
    help_text VARCHAR(500) NULL,
    options_json JSON NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_standard_field_setting (form_key, field_key)
);

CREATE TABLE IF NOT EXISTS system_import.sync_receipts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    source_type ENUM('production', 'abnormality') NOT NULL,
    client_record_id CHAR(36) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    server_record_id BIGINT NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sync_receipt (source_type, client_record_id)
);

CREATE TABLE IF NOT EXISTS system_import.cost_failure_types (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    type_code VARCHAR(80) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    definition TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cost_failure_type_code (type_code)
);

CREATE TABLE IF NOT EXISTS system_import.event_type_options (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_value VARCHAR(80) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    display_order INT NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_event_type_options_value (event_value)
);

CREATE TABLE IF NOT EXISTS system_import.daily_tasks (
    record_date DATE PRIMARY KEY,
    task_types JSON NOT NULL,
    task_items JSON NULL,
    reminders JSON NULL,
    custom_task VARCHAR(255) NULL,
    formula_code VARCHAR(50) NULL,
    amount_needed DECIMAL(14, 2) NULL,
    machine_assigned VARCHAR(20) NULL,
    updated_by BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_daily_tasks_updated (updated_at)
);

INSERT IGNORE INTO system_import.field_definitions
    (form_key, field_key, label, input_type, options_json, is_required, is_active, display_order)
VALUES
    ('abnormality', 'reason_code', 'Reason code / 原因代码', 'select',
     '["Equipment","Quality","Material","Personnel","Process","Other"]', FALSE, TRUE, 100);

INSERT INTO system_import.event_type_options
    (event_value, display_name, display_order, is_active)
VALUES
    ('Training', 'Training / 培训', 10, TRUE),
    ('Cleaning', 'Cleaning / 清洁', 20, TRUE),
    ('Feeding Material', 'Feeding Material / 投料', 30, TRUE),
    ('Inspection (FAI)', 'Inspection (FAI) / 点检', 40, TRUE),
    ('Normal Production', 'Normal Production / 正常生产', 50, TRUE),
    ('Preparation', 'Preparation / 准备', 60, TRUE),
    ('Equipment Event', 'Equipment Event / 设备异常', 70, TRUE),
    ('Personnel Event', 'Personnel Event / 人员异常', 80, TRUE),
    ('Material Event', 'Material Event / 物料异常', 90, TRUE),
    ('Quality Event', 'Quality Event / 品质异常', 100, TRUE),
    ('Process Adjustment', 'Process Adjustment / 工艺调整', 110, TRUE),
    ('Other Event', 'Other Event / 其他异常', 120, TRUE)
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    display_order = VALUES(display_order),
    is_active = TRUE;

INSERT IGNORE INTO system_import.cost_failure_types
    (type_code, display_name, definition)
VALUES
    ('customer_delivery_impact', 'Customer or delivery impact / 客户或交付影响', 'Expedite, penalty, or delivery disruption risk / 加急、罚款或交付中断风险'),
    ('energy_waste', 'Energy waste / 能源浪费', 'Energy consumed without useful output / 未产生有效产出的能源'),
    ('labour_overtime', 'Labour overtime / 人工加班', 'Additional labour required because of the event / 因异常产生的额外人工'),
    ('lost_production', 'Lost production / 产量损失', 'Planned output that could not be produced / 未能生产的计划产量'),
    ('maintenance_repair', 'Maintenance or repair / 维护或维修', 'Parts, contractors, or repair work / 零件、承包商或维修工作'),
    ('material_loss', 'Material loss / 材料损失', 'Raw material, slurry, packaging, or consumables lost / 损失的原料、浆料、包装或耗材'),
    ('safety_environmental_impact', 'Safety or environmental impact / 安全或环境影响', 'Potential safety, cleanup, compliance, or environmental cost / 潜在安全、清理、合规或环境成本'),
    ('scrap_rework', 'Scrap or rework / 报废或返工', 'Value of rejected product or work required to repair it / 不合格产品或返工成本');
