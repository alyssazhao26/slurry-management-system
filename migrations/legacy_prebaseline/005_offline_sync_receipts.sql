CREATE TABLE IF NOT EXISTS system_import.sync_receipts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    source_type ENUM('production','abnormality') NOT NULL,
    client_record_id CHAR(36) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    server_record_id BIGINT NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sync_receipt (source_type, client_record_id)
);
