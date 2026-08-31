These files are the original 15 incremental development migrations.

They are retained for audit and recovery only. The migration runner deliberately
reads only SQL files directly inside the migrations folder, so these legacy files
will not run on a new production server.

New servers run only:
  001_initial_schema.sql      - full current two-schema baseline
  002_reference_data.sql      - active UI categories and configurable field seed

The current test database already records the old migration filenames in
slurry_management.schema_migrations. It remains compatible with the application.
