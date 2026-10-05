# Changelog

All notable changes to Printworks are recorded here.

## 1.7 — 2026-10-05

### Added
- **PDF preflight**: check a PDF on its own, before it goes to your printer. Reads page size and trim and bleed boxes, font embedding (and Type 3 fonts), image colour space and effective resolution for every placement, RGB colour in text and artwork, spot colours and PDF/X output intent. Findings are grouped as problem, check, note and passed, with page links and page images for each problem.
- **PDF-first entry**: the start screen now offers "Check a PDF" first and "Explore typography" (IDML) second. With an IDML open as well, the preflight also checks page count and trim size against the layout.
- **One shared printer profile** (bleed, minimum image resolution, RGB policy, plus the existing text rules). Results update instantly as you change it.
- **Copy summary** and **Download report (JSON)** for the preflight, to send to a printer or keep.
- Practical hint for missing bleed: where to switch it on in InDesign's PDF export.

### Changed
- Start-screen wording now says what the app is: a PDF preflight and typography checker. New page title, topbar subtitle, introduction and "What it does" cards.

### Notes
- Checked against poppler on a 320-page PDF: 656 of 656 image placements matched, resolution within 1%, font embedding agreed. The minified browser build of pdf-lib gives the same results.
- New CDN script: pdf-lib from jsDelivr.
- Not checked: total ink coverage, overprint and trapping, transparency flattening, image content. Images inside tiling patterns are not found.

## 1.6 — 2026-10-05

### Added
- **Font map**: choose a new font family and style for each font in the file, or fill the table from a typography direction as a starting point. It is applied to paragraph styles, character styles and to text where the font was set directly, so no text keeps the old font. Only font family and style are changed.
- **Inheritance protection**: a style that inherits its font from a remapped parent is held at its original font unless it is mapped itself.
- **Verified export**: the new IDML is re-read and checked before download (only font settings changed, text and structure identical, every run resolves to the intended font, `mimetype` first and stored). A failed check withholds the download.
- **Print checks** with a saved printer profile: minimum text size, thin or light weights at small sizes, small text in more than one ink, small reversed-out text, and text frames past the trim or inside the safe margin. Checks run live against the new fonts as you edit the map.
- **Swatch handling**: colours are read from `Resources/Graphic.xml` (CMYK, tints, gradients, registration) so ink count and reversed-out text can be detected. Colours are never changed in the export; on-screen RGB is an approximation.
- Page explorer now draws the file's bleed and your safe margin.
- Document bleed and page margins are read from the file.

### Notes
- Distance to the trim edge is measured from the text frame, not the text inside it. Measuring text needs the page renderer.
- The existing Style Lab roles and typography-direction export are unchanged.

## 1.5 — 2026-10-05

### Added
- **Structure inspector**: a new section that follows every page to its text frames, every frame to its story, and every story to its styles. It works on any IDML (cards, boxes, books), not just one design.
- **Renderer readiness report**: each text frame is rated Ready, Approximate or Not supported yet for the upcoming page renderer, with the reason (threaded text, multiple columns, non-rectangular frames, tables, footnotes, anchored objects, scaled or skewed frames).
- **Page explorer**: a wireframe of each page's frames (with real rotation and position) beside a table of frame, story, paragraph styles, text, angle and vertical alignment.
- **PDF text check**: when a companion PDF is added, Printworks checks that each frame's text appears on the matching PDF page and flags text that is already cut off (overset) in InDesign, so a new font is not blamed for it later.
- **Download structure JSON** for debugging or for use in other tools.
- New `js/idml-model.js`: a UI-free IDML model (designmap order, page rectangles, transform composition through groups, stories, style cascade, `Fonts.xml`). It also loads in Node; see `tests/`.

### Fixed
- Font detection found no fonts in files where InDesign writes `AppliedFont` as a child element. Fonts are now read from styles, text and `Fonts.xml`, with their save-time status (installed, substituted, missing).
- Page order now follows `designmap.xml` instead of sorting by page name, which breaks when sections restart numbering or use labels such as `i` or `A-1`.

### Known limitations
- Text whose font is set directly on the text (not through a paragraph style) is not changed by Apply typography. The inspector reports how much of a document this affects. A font-mapping approach is planned.
- Style Lab still hides the default paragraph styles.
- Nothing is rendered from IDML text yet; that is the next step.

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
