# Cohnsoft brand guide

**Cohnsoft** is one company. AltStack and Artemis Softworks are now part of it. Founded by **Demetria Althea Cohn** (online: **Demie Althea Cohn**).

> Software in calm, good company.

## Identity

The mark is a lit white **C** holding a single **bit** (a small rounded square): a letter and a piece of data, "c" and "soft" in one shape. It sits on a green squircle tile. The wordmark is **cohnsoft**, lowercase, in Cohn Sans Bold, with "cohn" in ink (or white) and "soft" in Cohnsoft Green.

| Asset | Use |
|---|---|
| **App icon** `logos/app-icon/` | Dock, launchers, stores. Has the soft margin and shadow of a desktop icon. |
| **Mark** `logos/mark/` | Favicons, avatars, small UI. Fills its canvas. Drawn natively at 16, 32, 48, 64, 128, 256, 512 and 1024 px, so small sizes stay crisp. |
| **Glyph** `logos/glyph/` | The C and bit alone, in green, white or black, for any background or single-colour print. |
| **Lockup** `logos/lockup/` | Mark + wordmark, horizontal or stacked; light and dark. The default signature. |
| **Pixel mark** `logos/pixel/` | The original 64-pixel version, made in AltStack Sprite. For retro contexts and games. |
| **Social card, wallpapers** | `logos/social/`, `logos/wallpaper/`. |

Every raster logo has an editable Sprite document in `source/` (`.asprite.json`) and a vector twin (`.svg`) where it matters.

**Clear space:** keep at least the width of the bit (about 1/10 of the tile) free on all sides; one tile-height around the lockup is better.
**Minimum size:** mark 16 px; lockup 96 px wide; wordmark alone 64 px wide.
**Do not:** recolour the tile, stretch or rotate the mark, add outlines or extra shadows, place the lockup on busy imagery, set "soft" in another colour, or typeset "cohnsoft" in another font.

## Colour

One green; everything else is a quiet neutral. See `tokens.json` and the contrast table in `index.html`.

| Name | Hex | Notes |
|---|---|---|
| **Cohnsoft Green** (Green 500) | `#25bb5d` | The brand colour. Logo and large display type only (2.5:1 on white). |
| Green 700 | `#0a7a37` | Green **text** and links on light (5.4:1 on white). |
| Green 400 | `#3fd477` | Tint on dark surfaces (8.8:1 on Night). |
| Green 900 | `#05361b` | Shadows, deep tint. |
| Ink / Graphite / Mist / Paper | `#1d1d1f` `#636366` `#f2f2f7` `#ffffff` | Text, secondary text, background, surface. |
| Night / Night Raised | `#1c1c1e` `#2c2c2e` | Dark appearance. |

## Typeface: Cohn Sans

An original typeface drawn for Cohnsoft (`fonts/`, Regular and Bold, TTF and WOFF2, SIL OFL 1.1). The clean, open feel of a modern system sans, plus reading aids from dyslexia-friendly faces: easily confused letters look different (b d p q, I l 1, O 0), bottoms are drawn heavier so each letter sits on the line, apertures are open, spacing is generous. Nothing was traced from another typeface. Use `css/cohnsans.css`. Fall back to the system font; a `data-font="system"` switch exists for people who prefer it.

## Design language: Golden Gate

Software that feels at home on a Mac and travels well to Windows and Linux. Inspired by the layered, translucent look of modern macOS; no third-party artwork, fonts or marks are used.

1. **Material over decoration.** Bars and sheets are frosted glass (18 px blur, saturated) over the green wallpaper; content sits on quiet surfaces.
2. **One tint.** Cohnsoft Green marks selection, focus and the primary action. Everything else is neutral.
3. **Soft geometry.** 8 px controls, 12 px groups, 22 px sheets.
4. **Depth from light.** A lit top edge, a darker lower edge, long soft shadows. Never hard black outlines.
5. **Accessible.** 4.5:1 text, a 3 px focus ring, reduced motion and reduced transparency respected, forced-colors supported.

`css/goldengate.css` implements this (tokens, wallpaper, glass toolbar, sidebar, sheet, card, grouped list, buttons, field, segmented control, switch, badge). Wallpapers: `logos/wallpaper/`.

## Voice and credits

Plain, warm, specific. Say what the software does; skip hype.
Standard credit: **A product of Cohnsoft.**  Founder line: **Cohnsoft was founded by Demetria Althea Cohn.**
Product names (AltStack Mail, AltStack Game Producer, Sprite, Box, and so on) stay as product identities; Cohnsoft is the company behind them. Keep upstream and third-party notices intact: Godot, Blender, BeepBox and the like are credited by their own licences.

## Provenance

Logos are Sprite documents: AltStack Sprite's model, saved as `.asprite.json` and exported with its PNG engine. Shapes are drawn procedurally (`tools/hd.js`, signed-distance geometry, so each size is drawn natively and never scaled), then opened in Sprite. Sizes beyond Sprite's 512-pixel document limit (1024 px icons, the social card, wallpapers) are drawn at full size and written with Sprite's PNG encoder. Rebuild everything: `node tools/build.js && node tools/site.js` (macOS also produces the `.icns`). The font: `PYTHONPATH=<fonttools> python3 fonts/build_font.py`.
