ALTER TABLE system_import.production_records
    ADD COLUMN achievement_rate DECIMAL(10, 4) NULL AFTER qualified_quantity,
    ADD COLUMN qualified_rate DECIMAL(10, 4) NULL AFTER achievement_rate;

UPDATE system_import.production_records
SET achievement_rate = CASE WHEN planned_quantity > 0 THEN actual_quantity / planned_quantity ELSE NULL END,
    qualified_rate = CASE WHEN actual_quantity > 0 THEN qualified_quantity / actual_quantity ELSE NULL END;

UPDATE system_import.field_definitions
SET is_active = FALSE
WHERE form_key = 'production' AND field_key = 'work_order';
