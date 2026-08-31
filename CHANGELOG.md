# Changelog

This project uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## Unreleased

### Added

- Added a saved font-size option for every factory-display canvas block, reflected in both the editor preview and public display.
- Documented development, test, and production release pipeline.
- Deployment environment templates and release verification gate.
- Added a prominent bilingual same-day reporting reminder to the employee home page.
- Added editable permanent text blocks that appear on both the factory display and employee home page without resetting each day.
- Added separate, selectable Production and Event column groups to daily report generation, including duration, notes, actions, solutions, and follow-up fields.
- Added bilingual structured-writing guidance for event descriptions, immediate actions, and completed solutions to improve later AI analysis quality without imposing a character-count minimum.
- Added editable department title and subtitle settings for the main application header and factory display.
- Separated application header text from the factory display’s small and large headings so all four values can be edited independently.
- Removed the application subtitle beneath the main title and removed its editor field; factory display headings remain independently editable.
- Added the multi-department deployment and configuration strategy in `documentation/13_multi_department_deployment.html`.
- Event Tracker follow-up now opens in a resizable modal containing the selected event’s ID, date/time, shift, machine, process, type, severity, description, and immediate action above the completion fields.

### Changed

- Manager edits to existing events no longer require an actual finish date or solution unless the edit newly closes the event; legacy resolved records can be corrected without inventing completion data.
- Consolidated every approved post-baseline database change from this development round into the single migration `002_approved_feature_round.sql`.
- Promoted the approved desktop test build into the GitHub-ready repository while preserving the committed `001` baseline and placing only new database changes in `002_approved_feature_round.sql`.
- Removed the Event tracker page's eyebrow, explanatory subtitle, and automatic-save subtitle while retaining its main title and event date.
- Removed the Production data page's eyebrow, explanatory subtitle, and automatic-save subtitle while retaining its main title and record date.
- Event Tracker records are ordered by event date and time descending (newest first).
- Updated the Production Records page subtitle to “Most recent production records / 最新生产数据记录,” while retaining “Production records / 生产记录” as the main heading.
- Event Tracker’s **Add event** action now opens the same complete operator event form used from the home page.
- Daily-task reminders are explicitly optional and may be saved as an empty list.
- Removed the “Operational details / 运营明细” report heading.
- Daily report queries now expose the complete approved set of selectable Production and Event fields.
- Display settings use a shorter two-column layout for event-column controls.
- Block title/order/visibility settings also use a two-column card layout, collapsing to one column on narrow screens.
- The display editor now uses the same fixed three-column, 140-pixel row grid as the configurable factory display, so widths and heights are visually proportional (for example, `1 × 2` is one column wide and two rows tall).
- Preview dimensions now use explicit width/height CSS classes instead of generated inline grid styles, ensuring the visible canvas always applies the saved size spans.
- Permanent notice text now preserves new lines and safely renders lines beginning with `-`, `*`, or `•` as bullets and numbered prefixes such as `1.` as ordered lists.
- Immediate Action is required only for unresolved events and now includes the bilingual guide “Fill this only if unresolved. / 仅在问题未解决时填写此项。”
- The standard-field option editor now explains the stable `saved value|display label` format used to preserve database compatibility while allowing bilingual labels.

### Fixed

- Prevented a JavaScript startup failure when a running server temporarily serves a cached pre-update HTML template with the updated JavaScript bundle; navigation and page buttons now remain usable during that mixed-cache state.
- Prevented the same mixed-cache condition from stopping the read-only factory display before today’s task and reminders are rendered; department header elements are now updated only when the matching HTML is present.
- Event Tracker now creates its follow-up dialog dynamically when a cached pre-dialog HTML template is still active, keeping the Update button functional during deployment.
- Manager event corrections now keep completion fields and status synchronized: Actual Finish plus Solution automatically resolves the event, partial completion is rejected, and Actual Finish cannot precede Event Date. Migration 019 reconciles existing rows that already contain both completion fields.
- Restored “Daily Factory Display / 每日工厂看板” as the default large display heading instead of incorrectly reusing the application subtitle “Central factory records · Local SQL.”
- Retired the redundant legacy Reason code custom field; Event type remains the supported event classification, while historical custom-field data is preserved.
- Removed the former “20+ characters” notices from database-configured Event description and Immediate Action guidance.

### Validation

- Python syntax check passed.
- JavaScript syntax check passed.
- Automated test suite passed: 3 tests.
- Changes are currently limited to the Desktop test copy and have not been promoted to the GitHub/main workspace.

## Release rules

- **PATCH**: safe bug fix with no schema or workflow change.
- **MINOR**: backward-compatible feature, new field, dashboard, or manager capability.
- **MAJOR**: breaking workflow, incompatible data change, or required operator retraining.

Every release must state its version, date, user-visible changes, migrations, test result, backup reference, deployment owner, and rollback decision.
