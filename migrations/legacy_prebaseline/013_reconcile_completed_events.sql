-- Repair records saved by earlier tracker versions: completion evidence was stored
-- but the resolved status was not updated.
UPDATE system_import.abnormality_reports
SET is_resolved = 'yes',
    state = 'resolved',
    row_version = row_version + 1
WHERE is_resolved = 'no'
  AND actual_finish_date IS NOT NULL
  AND solution_provided IS NOT NULL
  AND TRIM(solution_provided) <> '';
