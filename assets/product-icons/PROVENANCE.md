# Cohnsoft product icons

Original product-specific SVG geometry authored for this rebrand, using Cohnsoft green/neutral colours, translucent highlights and soft tile geometry. These do not alter or replace the canonical company mark.

Every icon has an editable `.asprite.json` document and SVG source. PNGs were exported with the original Cohnsoft Sprite document, session and export engine vendored in `danecohn/cohnsoftassets` at `752e894f90f1e58e62ae466352cb03c8bfd7d703` (`tools/sprite/`, GPL-3.0). Legacy `amerika-sprite` file-format identifiers are intentionally retained for compatibility. Sharp rasterizes the original SVG before import into the Sprite document. No third-party artwork is used.

Rebuild with a checkout of the pinned brand repo alongside this repo:

`COHN_SPRITE_ENGINE=../cohnsoftassets/tools/sprite node tools/build-cohnsoft-icons.cjs`

The app ships the exported PNGs locally; it does not require the authoring tool at runtime. Company assets in `public/brand/cohnsoft` remain copied byte-for-byte with their own manifest.
