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

INSERT IGNORE INTO system_import.event_type_options (event_value, display_name, display_order) VALUES
    ('Equipment event', 'Equipment event / 设备异常', 10),
    ('Quality event', 'Quality event / 质量异常', 20),
    ('Material event', 'Material event / 材料异常', 30),
    ('Personnel event', 'Personnel event / 人员异常', 40),
    ('Process adjustment', 'Process adjustment / 工艺调整', 50),
    ('Other event', 'Other event / 其他异常', 60);
