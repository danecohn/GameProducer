# Sprite

A pixel-art editor and animator with an AI sprite builder. Package `amerika-sprite` (arch all; Depends `amerika-studio`, `gir1.2-webkit-6.0`), launcher `amerika-sprite`, app id `org.amerika.Sprite`, project folder `~/Studio/Sprite`.

**Licensing.** Sprite is original code. It is **not Aseprite** and is not affiliated with Aseprite or Igara Studio. No Aseprite source was copied, ported or translated; Aseprite was only a feature reference. The `.aseprite`/`.ase` reader is **import only** and was written from the public file-format spec (`docs/ase-file-specs.md`); there is deliberately no `.aseprite` writer. Native format: `.asprite.json` (deflated cels, base64) plus PNG/sheet exports.

## Layout of the source (`src/os/sprite/`)
- `app/` static page (no CDN, no build step): `index.html`, `style.css`, `icon.svg`, `js/*.js`.
  - Pure logic (tested with Node, also loaded as browser globals `AS.*`): `zlib` (inflate + LZ77 deflate), `png` (PNG/APNG encode, PNG decode), `gif` (own LZW GIF89a encoder + median cut), `color` (palettes, importers), `model` (document, layers/frames/tags, compositing, undo/redo), `draw` (primitives, fills, dither, transforms, Scale2x, RotSprite-like rotation), `export` (sheets, Aseprite-compatible JSON, Godot `.tres`), `aseprite` (import-only reader), `session`, `tools` (AI/RPC tools), `ai` (system prompt + loop), `rpc` (`sprite.*` handlers).
  - UI: `ui-base`, `editor`, `panels`, `app`, `dev-shim` (plain-browser fallback).
- `bin/amerika-sprite`, `applications/amerika-sprite.desktop`, `icons/amerika-sprite.svg`, `test/*.test.js`.

## Editor
Layers (visibility, lock, opacity, 14 blend modes), frames with durations, tags (forward/reverse/ping-pong), onion skin, playback, indexed and RGBA modes, palette editor (add/remove/edit/sort/ramp, import GPL/hex/JASC/PNG, export GPL, presets PICO-8, Sweetie 16, Endesga 32, DawnBringer 16, Game Boy, C64, grayscale, fire, Amerika neon). Tools: pencil (pixel-perfect), eraser, bucket (tolerance, contiguous), line, rectangle, ellipse, polygon, rectangular/lasso/magic-wand selection, move, eyedropper, shading brush, dither brush, gradient dither; mirror X/Y, tiled drawing (X/Y/both), tiled preview, grid, zoom/pan, undo/redo (command stack; one AI turn = one step). Edit menu: flip, rotate (RotSprite-like), shift, outline, drop shadow, shade by light direction, replace colour, hue/saturation; Sprite menu: canvas size, Scale (nearest or Scale2x/EPX), crop, colour mode. Shortcuts are customisable (Help > Keyboard shortcuts; stored in localStorage). Tab hides the side panels.

## Import / export
Open: `.asprite.json`, PNG (optional slicing into frames), `.aseprite/.ase` (read-only), palettes (`.gpl .hex .pal`, PNG). Drag-drop and "Open recent" use the shell. Export dialog: sprite sheet (PNG + Aseprite-compatible JSON array + Godot `SpriteFrames` `.tres` + AtlasTexture `.atlas.gd`), PNG, GIF, APNG, one PNG per frame; scale 1-32, tag selection, trim, padding, spacing, inner padding, layouts (strip, grid, packed). Tags become animation names (ping-pong/reverse expanded, loop from repeat). All writes go through `amerikaStudio.fs.writeProject` (confined to `~/Studio/Sprite`) or native save dialogs.

## AI panel
Chat panel using `amerikaStudio.AIClient` (falls back to a local loop over `amerikaStudio.request`); no key in the page. Tools (validated, atomic): `canvas_info set_canvas resize set_palette draw_pixels draw_shape fill_region new_layer new_frame delete_frame delete_layer select layer_properties set_frame_duration set_tag copy_frame_with_transform shift rotate mirror recolor outline drop_shadow shade_by_light_direction clear view_canvas undo export`. `draw_pixels` takes legend rows (chars 0-9a-zA-Z = palette index), run-length rows (`4x. 3xa`), rects or pixel triples. `view_canvas` returns the frame upscaled with grid and pixel rulers (or a contact sheet of all frames). The system prompt teaches plan palette/silhouette, block, shade, highlight, check, animate, plus pixel-art rules. Tool results carry an ASCII picture so the model can iterate cheaply.

## Control endpoint
`onRpc` implements every `sprite.*` tool in `src/os/studio/tools.json` (`canvas.info`, `canvas.describe_to_sprite`, `canvas.apply_change`, `frames.*`, `palette.get/set`, `export`, `app.prompt`); AI-backed ones drive the same chat panel and return the reply, tool names and a PNG view. Errors use the JSON-RPC codes of tools.json (-32602 invalid params, -32003 path outside project, -32002 busy, -32601 unknown).

## Tests
`../tools/node/bin/node --test 'src/os/sprite/test/*.test.js'` (drawing, flood fill, history, palettes, RLE, GIF round trip, `.aseprite` hand-built fixtures, sheet/tres output, AI loop with a fake bridge, RPC). `tests/test_studio_sprite.py` runs them (skipped without Node), verifies outputs with PIL, and checks packaging. `tests/rig/sprite_rig.sh` renders the real UI in WebKit (fake bridge, canned AI sprite).
