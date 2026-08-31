CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    employee_code VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    role ENUM('operator', 'supervisor', 'administrator') NOT NULL,
    pin_hash VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    record_date DATE NOT NULL,
    shift_name VARCHAR(50) NOT NULL,
    machine_code VARCHAR(50) NOT NULL,
    formula_code VARCHAR(50) NOT NULL,
    batch_number VARCHAR(80) NOT NULL,
    planned_quantity DECIMAL(14, 2) NOT NULL,
    actual_quantity DECIMAL(14, 2) NOT NULL,
    qualified_quantity DECIMAL(14, 2) NOT NULL,
    notes TEXT,
    state ENUM('submitted', 'approved', 'correction_requested') NOT NULL DEFAULT 'submitted',
    row_version INT NOT NULL DEFAULT 1,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_production_quantities CHECK (
        planned_quantity >= 0
        AND actual_quantity >= 0
        AND qualified_quantity >= 0
        AND qualified_quantity <= actual_quantity
    ),
    CONSTRAINT fk_production_user FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE KEY uq_production_entry (record_date, shift_name, machine_code, batch_number)
);

CREATE TABLE IF NOT EXISTS abnormality_reports (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_date DATE NOT NULL,
    shift_name VARCHAR(50) NOT NULL,
    machine_code VARCHAR(50) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    severity ENUM('low', 'medium', 'high') NOT NULL,
    duration_minutes INT NOT NULL,
    description TEXT,
    immediate_action TEXT,
    state ENUM('open', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    row_version INT NOT NULL DEFAULT 1,
    reported_by BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_duration CHECK (duration_minutes >= 0),
    CONSTRAINT fk_abnormality_user FOREIGN KEY (reported_by) REFERENCES users(id)
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

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_id BIGINT NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT NOT NULL,
    action VARCHAR(80) NOT NULL,
    details_json JSON NOT NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_entity (entity_type, entity_id),
    CONSTRAINT fk_audit_user FOREIGN KEY (actor_id) REFERENCES users(id)
);
