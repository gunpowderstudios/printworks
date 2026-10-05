# Changelog

All notable changes to Printworks are recorded here.

## 1.4 — 2026-10-05

### Added
- **Live Preview**: selecting Editorial, Modern, Humanist or Classic immediately changes the IDML thumbnail typography.
- Style Lab samples now reflect the currently selected typography direction before export.
- Added a visible Live Preview badge and **Show original** control.
- PDF thumbnails remain untouched as the original reference.

### Fixed
- Connected the existing IDML page-geometry parser to document analysis, so real page aspect ratios are now actually used.


## 1.3.4 — 2026-10-05

### Fixed
- Read `AppliedFont` and `Leading` from the real IDML paragraph-style `Properties` block.
- Selecting a typography direction can now update the actual existing paragraph styles assigned in Style Lab, instead of mostly adding unused Printworks styles.
- Existing point sizes, colours, alignment, spacing and other layout settings are preserved when changing typography.
- Reworked IDML page-bound parsing to read `GeometricBounds` directly from each `<Page>` tag.
- Strengthened thumbnail aspect-ratio styling so 50 × 50 mm Deck of Dungeon cards display square.

### Verified
- Deck of Dungeon uses styles including `item title`, `card text small`, `rules`, `rules heading` and `item tile description`.
- Its card pages report 141.732 × 141.732 pt, equivalent to 50 × 50 mm.


## 1.3.3 — 2026-10-05

### Added
- IDML page thumbnails now use each page's real `GeometricBounds` aspect ratio.
- Detected page dimensions are shown on IDML-only thumbnails in millimetres.
- Supports square cards, portrait pages, landscape pages and mixed page sizes.

### Verified
- Tested against the uploaded Deck of Dungeon IDML: 141.732 × 141.732 pt = 50 × 50 mm square cards.


## 1.3.2 — 2026-10-05

### Improved
- Switched both export paths to a safer IDML packager.
- Preserved the IDML/UCF requirement that the `mimetype` entry is written first and uncompressed.
- Made Style Lab tidy export more conservative by keeping original style definitions while remapping usage to canonical Printworks styles.


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
