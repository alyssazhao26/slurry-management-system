-- GNEM migration 003: add the Slitting department to an installation that
-- already has the immutable 001 baseline and 002 approved feature round.
-- This migration is intentionally Slitting-only. The migration runner applies
-- it to the configured SLITTING_DB_NAME and SLITTING_IMPORT_SCHEMA.

ALTER TABLE system_import.production_records
    ADD COLUMN product_code VARCHAR(80) NULL AFTER machine_code,
    ADD COLUMN parent_roll_number VARCHAR(80) NULL AFTER product_code,
    ADD COLUMN slit_width_mm DECIMAL(10,2) NULL AFTER parent_roll_number,
    ADD COLUMN thickness_um DECIMAL(10,3) NULL AFTER slit_width_mm,
    ADD COLUMN roll_length_m DECIMAL(12,2) NULL AFTER thickness_um;

CREATE TABLE IF NOT EXISTS system_import.inventory_products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    qr_token CHAR(36) NOT NULL,
    roll_number VARCHAR(80) NOT NULL,
    product_code VARCHAR(80) NULL,
    material_code VARCHAR(80) NULL,
    parent_roll_number VARCHAR(80) NULL,
    slit_width_mm DECIMAL(10,2) NULL,
    thickness_um DECIMAL(10,3) NULL,
    roll_length_m DECIMAL(12,2) NULL,
    net_weight_kg DECIMAL(12,3) NULL,
    production_date DATE NULL,
    machine_code VARCHAR(50) NULL,
    location VARCHAR(120) NULL,
    status ENUM('in_stock','out') NOT NULL DEFAULT 'in_stock',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    label_created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checked_out_at TIMESTAMP NULL,
    UNIQUE KEY uq_inventory_qr_token (qr_token),
    UNIQUE KEY uq_inventory_roll_number (roll_number),
    INDEX idx_inventory_status_product (status, product_code),
    INDEX idx_inventory_created (created_at),
    INDEX idx_inventory_label_created (label_created_at)
);

CREATE TABLE IF NOT EXISTS system_import.inventory_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    product_id BIGINT NOT NULL,
    transaction_type ENUM('in','out') NOT NULL,
    quantity_delta INT NOT NULL,
    source VARCHAR(30) NOT NULL,
    scanned_by VARCHAR(120) NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inventory_transaction_product FOREIGN KEY (product_id)
        REFERENCES system_import.inventory_products(id),
    INDEX idx_inventory_transactions_product_time (product_id, occurred_at),
    INDEX idx_inventory_transactions_time (occurred_at)
);

CREATE TABLE IF NOT EXISTS system_import.slitting_model_specs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    model_code VARCHAR(100) NOT NULL,
    width_m DECIMAL(10,4) NULL,
    coated_length_m DECIMAL(12,2) NULL,
    coated_width_m DECIMAL(10,4) NULL,
    stations INT NULL,
    slitting_length_m DECIMAL(12,2) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by INT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_slitting_model_code (model_code)
);

INSERT IGNORE INTO system_import.slitting_model_specs
    (model_code, width_m, coated_length_m, coated_width_m, stations, slitting_length_m)
VALUES
('F/SNMK13E2211H-C(1.5-K1-26)-1/513MM',0.5130,2060,NULL,NULL,2000),
('F/SNMK13E2211H-C(1.5-K1-26)-1/514.9MM',0.5149,2060,NULL,NULL,2000),
('F/SNMK13E2211H-C(1.5-K1-26)-1/515.6MM',0.5156,2060,NULL,NULL,2000),
('F/SNK14E2211H/B1-1+K1-26/547MM',0.5470,2060,NULL,NULL,2000),
('F/SP511J2011A/242MM',0.2420,2060,NULL,NULL,2000),
('F/SNK14E2211H/515.4MM',0.5154,2060,NULL,NULL,2000),
('F/SNK14E2211H/270.6MM',0.2706,2060,1.1000,3,2000),
('F/SNK14E2211H/270MM',0.2700,2060,1.1000,3,2000),
('F/SHK13J22E-1/88.8MM',0.0888,2060,1.0200,11,2000),
('F/SFM213B3000A3-5/67.1MM',0.0671,2060,NULL,NULL,2000),
('F/SHO-CEC-E/73.8MM',0.0738,2060,1.0200,NULL,2000),
('F/SHO-CEC-E/96MM',0.0960,2060,1.0200,10,2000),
('F/SNL12J2211H-1/B1-1+K1-26/515.4MM',0.5154,2060,1.2000,NULL,2000),
('F/SNK14E2211H/264.5MM',0.2645,2060,1.1000,NULL,2000),
('F/SHK12E22H/88.8MM',0.0888,2060,1.1000,11,2000),
('F/SHK12E22H/E3/88.8MM',0.0888,2060,1.1000,11,2000),
('F/SHK13J22H/B1/88.8MM',0.0888,2060,1.0200,11,2000),
('F/SNK14E2211H/269.8MM',0.2698,2060,1.1000,3,2000),
('F/SHK13J22E-1/61MM',0.0610,2060,1.0200,15,2000),
('F/SHO-CEC-E/73.7MM',0.0737,2060,1.0200,13,2000),
('F/SHK13J22E-1/96MM',0.0960,2060,1.0200,10,2000),
('F/SNL-12J2211H-1/557.20MM',0.5572,2060,1.2000,2,2000),
('F/SHK13J22E-1/62.3MM',0.0623,2060,1.0200,NULL,2000),
('F/SHK13J22E-1/61.1MM',0.0611,2060,1.0200,15,2000),
('F/SHK13J22E-1/61.6MM',0.0616,2060,1.0200,15,2000),
('F/SHK13J22E-1/93.7MM',0.0937,2060,1.0200,10,2000),
('F/SHK13J22E-1/73.5MM',0.0735,2060,1.0200,13,2000);
