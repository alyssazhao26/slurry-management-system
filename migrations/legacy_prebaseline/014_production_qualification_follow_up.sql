ALTER TABLE system_import.production_records
    MODIFY COLUMN qualified_quantity DECIMAL(14, 2) NULL,
    ADD COLUMN qualified_pending BOOLEAN NOT NULL DEFAULT FALSE AFTER qualified_quantity;

UPDATE system_import.production_records
SET qualified_pending = qualified_quantity IS NULL;
