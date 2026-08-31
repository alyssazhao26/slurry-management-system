-- Recovery ledger entry. The original execution created the required tracker
-- fields and idx_abnormality_ongoing before the migration runner could record
-- completion. This safe no-op lets the runner record that completed state.
SET @slurry_tracker_recovery = 1;
