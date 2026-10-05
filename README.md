# Printworks

**Version 1.5**

Printworks is a browser-based typography exploration tool for Adobe InDesign IDML documents.

## v1.5 structure inspector

Printworks now reads how an IDML is put together before it tries to draw it:

- Pages come from `designmap.xml` in document order, with each page's real rectangle (its `GeometricBounds` transformed by its `ItemTransform`).
- Text frames are found anywhere on a spread, including inside groups, with their transforms composed. Each frame is linked to its story through `ParentStory`, and threaded frames through `PreviousTextFrame` / `NextTextFrame`.
- Stories are split into paragraphs at `<Br/>` and into runs, keeping paragraph style, character style and any formatting set directly on the text.
- Every frame is rated **Ready**, **Approximate** or **Not supported yet** for the planned page renderer. This keeps results honest across card decks, boxes and books.
- With a companion PDF, a text check compares each frame with the PDF page and flags text already cut off in InDesign.

The model in `js/idml-model.js` has no UI code and also runs in Node:

```
cd tests && npm install && node run-model-test.js path/to/file.idml path/to/file.pdf
```

(The PDF step needs `pdftotext` from poppler.) The tests folder is optional; the app itself still needs no build step.

## v1.4

- Upload an `.idml` file locally in the browser.
- Inspect page/spread count, stories, word count, detected fonts and named styles.
- Show lightweight page cards using text extracted from the IDML.
- Optionally add the matching PDF for accurate rendered page thumbnails.
- Click any rendered PDF thumbnail to open **Page Lab**.
- Extract text from the selected PDF page with PDF.js.
- Infer a likely kicker, headline and body from that page.
- Compare the actual page wording across all typography directions beside the original rendered page.
- Warn when PDF and IDML page counts do not match.
- Compare four typographic mood-board directions.
- Use **Style Lab** to inspect existing paragraph styles as pure typography.
- Assign styles to semantic roles such as Card Heading, Item Heading, Item Description, Body, Caption and Rules Note.
- Choose a master style for each role and export a tidied IDML.
- The tidy export remaps style references across the IDML package and removes the duplicate style definitions you chose to unify.
- Export a new IDML with a **Printworks** paragraph-style group containing:
  - PW Headline
  - PW Body
  - PW Label
- Optionally remap obvious existing headline/body/label styles to the new styles.
- The original IDML is never modified.
- Files are processed locally in the browser.

## Live preview

Selecting a typography direction now changes the IDML-only page thumbnails and Style Lab typography samples immediately. The selected mood is shown as a live preview before export. PDF thumbnails remain unchanged so they can act as the original visual reference.

## Typography application

When **Apply this typography to the existing styles assigned in Style Lab** is enabled, the selected mood now updates the font family and font style of those real InDesign paragraph styles while preserving their existing point size, colour, alignment, spacing and other layout properties.

## IDML packaging

Exports now preserve the IDML/UCF requirement that the `mimetype` entry is written first and uncompressed. Tidied exports currently keep the original paragraph-style definitions for safety while remapping usage to canonical Printworks styles.

## Important limitation

IDML does not contain a rendered page preview in the same way as a PDF. IDML-only mode therefore shows a structural/textual page approximation rather than pixel-perfect InDesign rendering.

Printworks references fonts in the generated paragraph styles but does **not** package or redistribute font files. InDesign will resolve installed fonts in the normal way and report missing fonts if necessary.

## GitHub Pages

The project is static and can be hosted directly with GitHub Pages from the repository root.

## Future ideas

- PDF import for visual analysis.
- Real page thumbnails via PDF/preview companion upload.
- More typography systems and user-defined style packs.
- Font filtering by licence, era, genre and readability.
- Better style-role detection.
- Master-page and object-style recommendations.
- Colour/palette extraction and alternatives.
- More advanced page hierarchy detection using IDML geometry and PDF text coordinates.
- AI-assisted layout critique.


## Versioning

Printworks uses semantic-style versioning for app changes:

- **Major** (`2.0`) — substantial workflow or compatibility changes.
- **Minor** (`1.4`) — new features.
- **Patch** (`1.3.1`) — fixes and small refinements.

Every released change should update the visible app version and add an entry to `CHANGELOG.md`.
