# Printworks

**Version 1.0**

Printworks is a browser-based typography exploration tool for Adobe InDesign IDML documents.

## v1.0

- Upload an `.idml` file locally in the browser.
- Inspect page/spread count, stories, word count, detected fonts and named styles.
- Show lightweight page cards using text extracted from the IDML.
- Compare four typographic mood-board directions.
- Export a new IDML with a **Printworks** paragraph-style group containing:
  - PW Headline
  - PW Body
  - PW Label
- Optionally remap obvious existing headline/body/label styles to the new styles.
- The original IDML is never modified.
- Files are processed locally in the browser.

## Important limitation

IDML does not contain a rendered page preview in the same way as a PDF. Version 1.0 therefore shows a structural/textual page approximation rather than pixel-perfect InDesign rendering.

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
- AI-assisted layout critique.
