# Printworks

**Version 1.7**

Printworks is a browser-based print checker and typography tool for InDesign files. Drop in the PDF you are about to send to your printer and it checks bleed, fonts, image resolution and colour. Then, when you want to try a different typeface, open the IDML and see how the change would print. Nothing is uploaded; your files are read in your browser.

Made for people who design card games, board games, boxes and books in InDesign.

**1. Check a PDF** (works on a PDF alone)

- Page size, trim and bleed boxes, against the bleed your printer needs.
- Fonts: every font embedded, no Type 3.
- Images: colour space (RGB, CMYK, Lab, spot) and effective resolution of every placement.
- **Colour, the old-school way:** one clear verdict on whether everything is CMYK or grayscale, then the detail. RGB or Lab in images, text, artwork, gradients and the page blending space; spot colours (Pantone, foil, varnish) with their tints and the pages they are on; registration colour used by mistake; total ink in text and artwork against your limit; overprint.
- **Colours used:** a swatch list of every colour actually painted (spot, CMYK builds, grays, gradients, images by colour space), and a page map showing which pages carry spot, RGB or registration colour.
- With an IDML open as well: page count and trim size against the layout.

**2. Explore typography** (needs the IDML)

- Reads how the IDML is built (pages, text frames, stories, styles, fonts, colours).
- Maps every font to a new one, including text where the font was set directly, and exports a revised IDML that changes font family and style and nothing else.
- Checks the result against your printer's rules: minimum text size, thin weights, small text in several inks, small reversed-out text, text frames near the trim.
- With the companion PDF, finds text that is already cut off in InDesign.

One **printer profile** (bleed, minimum resolution, RGB policy, minimum text sizes, safe margin) drives both. Change a value and every result updates straight away.

**What it is not**

- It is not a replacement for your printer's own preflight, which has the final word.
- It is not a replacement for InDesign: it does not edit layouts or make the final PDF.
- It does not reproduce InDesign's text engine exactly, so typography checks are warnings, not proof.
- It does not draw the pages yet (planned).

## v1.7 PDF preflight

The checker reads the PDF's structure with [pdf-lib](https://pdf-lib.js.org/) and walks each page's drawing instructions just far enough to find where images are placed (for resolution), which fonts are used, and whether RGB colours are painted. No images are decoded, so a 36 MB, 320-page PDF takes roughly 10 seconds.

It was checked against poppler's `pdfimages` and `pdffonts` on a real 320-page PDF: all 656 image placements matched, with effective resolution within 1%, and font embedding agreed. The minified browser build of pdf-lib gives identical results.

**Not checked:** ink coverage inside images, trapping, transparency flattening, and how images actually look. Overprint is reported, not previewed. Images painted through tiling patterns are not counted for resolution. Password-protected PDFs cannot be read; export an unprotected copy. Images inside soft masks (drop shadows, feathering) are read but left out of the colour and resolution findings, because their resolution does not affect print quality.

**Libraries.** pdf-lib loads from jsDelivr, alongside JSZip and PDF.js from cdnjs. Only code is fetched; your files never leave the browser.

## v1.6 font map, print checks and verified export

**Font map.** Each font in the file (family and style) can be mapped to a new family and style. The change is applied everywhere the font can be set:

- paragraph and character styles,
- formatting on a paragraph or character range in the stories (text where the font was set directly, which styles alone would miss).

A style that merely *inherits* its font from a remapped parent is held at its original font unless you map it too, so nothing changes by accident. Only font family and font style are written. The XML is edited as text rather than re-serialised, so every other byte is untouched.

**Verified export.** Before offering the download, Printworks re-reads the new package and checks that: only font settings changed (it compares the files with font settings removed), text and paragraph structure are identical, every text run resolves to the font you chose, and the package follows the IDML rules (`mimetype` first and stored). If a check fails, no download is offered.

**Print checks.** Enter your printer's specs once (saved in this browser). The starting values are common rules of thumb, not a standard. Sizes, weights and ink colours are exact, read straight from the file; colours stay as swatch references and are never converted. Distance to the trim edge is measured from the frame box, not from the text inside it, because measuring real text needs the page renderer. The page explorer draws the file's own bleed and your safe margin.

**Fonts must match InDesign's names.** The export writes the family and style names you type. If InDesign does not have a font installed with exactly that name and style, it shows the pink missing-font substitution. Printworks warns about families that are not in the file's own font list.

Tests (optional, Node only):

```
cd tests && npm install
node run-model-test.js file.idml file.pdf   # structure report + PDF check
node fontmap-test.js file.idml              # font map: synthetic cases, then your file
node printcheck-test.js file.idml           # print checks
node preflight-test.js file.pdf             # PDF preflight (synthetic PDFs, then compared with poppler)
PDFLIB_MIN=1 node preflight-test.js file.pdf  # same, against pdf-lib's minified browser build
```

`tests/fixtures/colour-test.pdf` is a tiny PDF with a Pantone spot colour, a registration colour, RGB, gradients, overprint and an RGB blending space. Drop it into the app to see how each one is reported.

```
```

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
