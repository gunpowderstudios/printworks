# Changelog

All notable changes to Printworks are recorded here.

## 1.3.1 — 2026-10-05

### Fixed
- Improved **Auto tidy** so it visibly classifies more real-world InDesign style names.
- Added typography-based heuristics using size and boldness.
- Auto tidy now resets and rebuilds Master selections correctly.
- Added visible feedback showing how many styles were assigned.

### Maintenance
- Formalised versioning and changelog policy.
- Cleaned README formatting.

## 1.3 — 2026-10-05

### Added
- **Style Lab** for inspecting existing paragraph styles as typography samples.
- Semantic roles including Card Heading, Item Heading, Item Description, Body, Caption, Rules Note and Section Heading.
- Master-style selection for each role.
- Tidied IDML export with canonical Printworks Clean Styles.
- Style-reference remapping across IDML XML files.
- Removal of deliberately unified duplicate paragraph-style definitions.

### Fixed
- Repaired JavaScript syntax issues that blocked uploads during development.

## 1.2 — 2026-10-05

### Added
- **Page Lab** for page-specific typography exploration.
- PDF text extraction using PDF.js.
- Headline, kicker and body inference from selected PDF pages.
- Side-by-side original page and typography-treatment views.

## 1.1 — 2026-10-05

### Added
- Optional companion PDF upload.
- Accurate PDF page thumbnails rendered in-browser.
- Large page preview.
- PDF/IDML page-count mismatch warning.

### Fixed
- Removed literal newline escape characters that prevented the app from loading.

## 1.0 — 2026-10-05

### Added
- Initial browser-only IDML analysis app.
- IDML structure, font and paragraph-style inspection.
- Basic page approximations.
- Four typography mood-board directions.
- Export of new IDML files with Printworks paragraph styles.
