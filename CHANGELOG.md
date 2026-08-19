# Changelog

This project uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## Unreleased

### Added

- Documented development, test, and production release pipeline.
- Deployment environment templates and release verification gate.

## Release rules

- **PATCH**: safe bug fix with no schema or workflow change.
- **MINOR**: backward-compatible feature, new field, dashboard, or manager capability.
- **MAJOR**: breaking workflow, incompatible data change, or required operator retraining.

Every release must state its version, date, user-visible changes, migrations, test result, backup reference, deployment owner, and rollback decision.
