# MakBox

MakBox is a desktop copy of **BeepBox** (John Nesky, MIT) with an AI composer. It runs in the shared
`amerika-studio-webview` window (see `webview.md`). MakBox is **not affiliated** with BeepBox or John Nesky;
beepbox.co is a separate hosted site. Credit lives in About, `NOTICE`, the package `copyright`, and the licence text
(`/usr/share/doc/amerika-box/LICENSE-BeepBox.md`).

## Layout

```
src/os/box/
  beepbox.lock.json        pinned upstream commit, tarball SHA-256, hashes of the vendored build, patch list
  patches/*.patch          our changes to BeepBox's own source (git format-patch series)
  app/                     what ships: index.html, beepbox_editor.min.js (editor), beepbox_synth.min.js (headless synth for tests),
                           amerika/*.js|css (our layer), amerika/vendor/lame.min.js (MP3 encoder, LGPL)
  bin/amerika-box          launcher (webview + Ogg helper), bin/amerika-box-ogg  ffmpeg Ogg helper / CLI
  applications/amerika-box.desktop, NOTICE, LICENSE-BeepBox.md, tools/update-upstream.sh, test/
tools/builders/box.py      -> amerika-box_<ver>_all.deb (Depends amerika-studio, gir1.2-webkit-6.0; Recommends ffmpeg)
```
The icon `amerika-box.svg` ships in `amerika-studio` (hicolor); this package depends on it and does not duplicate it.

## Upstream, patches, updating

Pinned: `johnnesky/beepbox` commit `355e510099d230d066d95074c16d748d59fe054c` (4.2.2 + 5 commits), tarball SHA-256 in the lock.
Only the static build is vendored, not `node_modules`. Patches:
1. *Offline build*: MP3 encoder loaded from `amerika/vendor/lame.min.js` instead of a CDN; service worker, URL shortener, share and embed
   entries removed (the shipped app makes no network requests; a Node test scans for them).
2. *Shell hooks*: `amerika-editor-ready` event (gives our layer the `SongEditor` and `SongDocument`), `window.amerikaSaveBlob` save hook in
   the export prompt, `ChangeSong`/`SongRenderer` exported.

Our UI, theme (derived at start-up from BeepBox's own "dark classic" variables, so upstream themes are untouched), tools and exporters are
separate files, so upstream updates only need the two small patches to apply. To update: `src/os/box/tools/update-upstream.sh [COMMIT]`
(clones, `git am`s the patches, builds with Node, copies the two min.js files). If a patch no longer applies, fix it in the printed scratch clone,
`git format-patch` into `patches/`, then refresh `beepbox.lock.json` (commit, tarball hash printed by the script, built hashes) and run the tests.

## Composer

Side panel docked in the editor. `amerikaStudio.AIClient` (from studio-core) runs the tool loop in the page; the bridge holds the key.
Tools (`app/amerika/songtools.js`), all validated through BeepBox's `Song.toJsonObject/fromJsonObject` and committed as a BeepBox
`ChangeSong`, so Edit > Undo / Z works (plus an "Undo last AI turn" button):
`song_info, new_song, set_song_settings, add_channel, add_instrument, set_instrument, write_pattern, write_track, read_notes, set_sequence,
clear, delete, transform_notes, get_song_json, set_song_json, generate_part, genre_preset, theory, render_preview, analyze_audio, play, stop, undo`.
Channels, patterns, instruments and bars are numbered from 1; times are beats; pitches are note names or MIDI numbers (drum rows 0-11).
Note text format: `PITCH[/PITCH...]@START+LENGTH[vVOL][fENDVOL][bBEND]`, e.g. `C4@0+1 E4/G4@1+0.5v67`.
Invalid enum names are rejected with the allowed list; en/em-space variants in FM algorithm names are accepted.
The system prompt (`prompt.js`) teaches channel/pattern limits, drum semantics, chord types, instrument types and the
compose -> render_preview/analyze_audio -> refine loop. `render_preview`/`analyze_audio` render offline with BeepBox's synth (>= 32 kHz;
its drum filters are unstable below that) and return loudness, clipping, per-bar level, spectrum bands, tempo estimate, per-channel loudness and advice.
Music-theory helpers: scales, chord/progression parsing (roman numerals or names), drum templates, genre presets
(chiptune, battle, boss, town, dungeon, victory, defeat, menu, ambient), instrument presets, a calibrated 12-row drum kit.

## Files and export

* Open/Save/Save as use the shell dialogs (`.beepbox` or `.json` = BeepBox song JSON; BeepBox URL hashes are accepted when opening);
  Ctrl+S/O/N are remapped to save/open/new. Recent songs use the shell's recent list. Autosave writes `~/Studio/Box/autosave/autosave.json`
  5 s after a change; a "Restore" banner appears on the next clean start.
* Export menu: WAV, MP3, MIDI, JSON through BeepBox's own export prompt (Save File goes through the shell dialog).
* **Export for game**: `~/Studio/Box/exports/<name>/` with `<name>.wav` (intro + one seamless loop whose reverb tail wraps into the start, `smpl` loop chunk),
  `<name>.ogg` (via ffmpeg, LOOPSTART/LOOPLENGTH tags), `<name>.json` (loop/tempo metadata in seconds and samples, Godot values),
  `<name>.song.json`, Godot 4 `.import` presets (loop on, `loop_offset`, bpm, beat_count, bar_beats) and `README.txt`.
* Ogg: the webview contract has no process execution, so `amerika-box` starts `amerika-box-ogg --watch` (only if ffmpeg exists; single instance by flock;
  stopped with the window). The page writes `exports/.jobs/<id>.job.json`; the helper answers `<id>.result.json`; paths are confined to `~/Studio/Box`.
  Without it the WAV bundle is still written; `amerika-box-ogg file.wav --loop-start N --loop-length N` converts later.

## Control endpoint (local automation)

`window.amerikaStudio.onRpc` implements the `box.*` tools of `src/os/studio/tools.json`: `song.get`, `song.set`, `song.compose_from_description`,
`song.apply_change`, `play`, `stop`, `export.wav` (`path` relative to the project, `loops` 1-8; add `return_audio:true` to also get `audio:{mime,base64}`),
`app.prompt` (feeds the same panel; returns `reply`, `tool_calls`, usage, song summary). Errors: -32602 invalid params, -32003 path outside project,
-32002 busy, -32004 not ready / no key or bridge, -32000 timeout/other.

## Privacy

No network access from the page (CSP and navigation are restricted by the shell; the BeepBox services were removed). No key in the app.

## Tests

* `../tools/node/bin/node --test src/os/box/test/tools.test.js` (BeepBox's real Song/Synth headless): tool schemas, canned tool session, pitch/tick mapping,
  validation errors, round trips (JSON and URL hash), rendered pitch (A4 = 440 Hz in several keys), tempo, WAV length/PCM/loop chunk, game bundle seam,
  genre presets (audible, no clipping), drum kit ordering, no-network scan.
* `python3 -m unittest tests.test_studio_box` wraps the above (skips clearly if Node is missing), reads the exported WAV with Python's `wave`, checks
  lock/patches/licences/builder/desktop entry and the Ogg helper.
* WebKit rig: `tests/rig/studio-rig.sh src/os/box/test/rig/box_rig.sh` (real UI in the real shell, fake upstream with canned `tool_use` turns,
  control endpoint, AI-turn undo, export, screenshots in `dist/studio/box-*.png`).

## Not verified here

Real model quality; real audio output (the rig has no sound device; playback was exercised without errors); Godot actually importing the `.import`
presets; OGG/ffmpeg path on the laptop (tested with the dev machine's ffmpeg only).
