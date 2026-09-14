CREATE TABLE IF NOT EXISTS system_import.attendance_employees (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    employee_code VARCHAR(50) NOT NULL,
    employee_name VARCHAR(120) NOT NULL,
    staffing_company VARCHAR(120) NOT NULL,
    department VARCHAR(80) NULL,
    job_title VARCHAR(120) NULL,
    pin_hash VARCHAR(255) NOT NULL,
    pin_code CHAR(4) NULL,
    pin_reset_required BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_attendance_employee_code (employee_code),
    INDEX idx_attendance_employee_company_name (
        staffing_company,
        employee_name
    )
);

CREATE TABLE IF NOT EXISTS system_import.attendance_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    employee_id BIGINT NOT NULL,
    attendance_date DATE NOT NULL,
    clock_in DATETIME NULL,
    clock_out DATETIME NULL,
    paid_break_hours DECIMAL(4,1) NULL,
    total_hours DECIMAL(4,1) NULL,
    overtime_hours DECIMAL(4,1) NULL,
    status ENUM('present','absent','leave','excused')
        NOT NULL DEFAULT 'present',
    employee_note VARCHAR(500) NULL,
    manager_note VARCHAR(1000) NULL,
    row_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_attendance_employee_date (
        employee_id,
        attendance_date
    ),
    INDEX idx_attendance_date (attendance_date),
    CONSTRAINT fk_attendance_employee
        FOREIGN KEY (employee_id)
        REFERENCES system_import.attendance_employees(id)
);
