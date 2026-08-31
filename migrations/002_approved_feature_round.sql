-- Approved database changes after the immutable 001 production baseline.

-- Store manager-configurable factory-display branding, layout, permanent text,
-- per-block font sizes, visibility, and event-column selections as JSON.
CREATE TABLE IF NOT EXISTS system_import.display_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    settings_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Event type is the supported classification. Keep historical Reason code
-- values, but stop showing the redundant field on new event forms.
UPDATE system_import.field_definitions
SET is_active = FALSE
WHERE form_key = 'abnormality' AND field_key = 'reason_code';

-- Remove the former character-count wording from any saved field overrides.
UPDATE system_import.standard_field_settings
SET help_text = 'Use specific facts, and avoid entries such as “machine issue.” / 请填写具体事实，避免仅写“设备问题”。'
WHERE form_key = 'abnormality' AND field_key = 'description';

UPDATE system_import.standard_field_settings
SET help_text = 'Fill this only if unresolved. / 仅在问题未解决时填写此项。'
WHERE form_key = 'abnormality' AND field_key = 'immediate_action';

-- Completion requires both an actual finish date and a documented solution.
-- Reconcile older or manually edited rows whose status flags remained open.
UPDATE system_import.abnormality_reports
SET is_resolved = 'yes', state = 'resolved'
WHERE actual_finish_date IS NOT NULL
  AND TRIM(COALESCE(solution_provided, '')) <> ''
  AND (is_resolved <> 'yes' OR state <> 'resolved');
