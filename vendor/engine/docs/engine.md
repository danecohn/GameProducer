# Engine

Engine is **upstream Godot 4** (MIT; the distro `godot` package, tested with 4.7.2 arm64 and written for 4.4+) plus the
**`amerika_engine` editor plugin**. It is not a source fork. "Godot" is a trademark of the Godot Foundation; Engine is
not affiliated with or endorsed by it. Godot is not bundled: the package depends on the distro's `godot`.

Install: `sudo apt install amerika-engine` (or `amerika-developer`). Start it from the launcher "Engine" or `amerika-engine`.

## What you get

* **Dock "Amerika"** in the editor: chat with history (`.amerika/chat.json`), model choice, "Review" switch (ask before the
  assistant saves scripts it wrote), Stop, "Undo request"/"Redo", Assemble, New chat. Every chat request is one undo checkpoint:
  the files it touched are copied to `.amerika/history/<id>/before|after` (git-free) and registered with the editor's undo stack
  (`EditorUndoRedoManager`), so Edit > Undo works too.
* **Game Recipe** `res://amerika_recipe.json`: one JSON document describing the game (schema: `recipe.schema.json`, version 1).
  **Assembler**: `recipe_assembler.gd` turns it deterministically into scenes (`entities/*.tscn`, `levels/*.tscn`, `ui/hud.tscn`),
  `amerika_game.json` (runtime config), the input map, autoloads (`AmerikaGame`, `AmerikaDebug`), project settings and
  `export_presets.cfg`. Describe -> the assistant edits the recipe -> Assemble. Re-assembling is idempotent; files edited by hand
  since the last assembly are kept unless `overwrite=true`.
* **Behaviour components** (`addons/amerika_engine/components/*.gd`, plain scripts, no `class_name`): see the table below.
* **Templates** (`amerika-engine --list-templates`): `platformer_2d` (Coin Dash), `topdown_shooter` (Neon Swarm), `arena_3d`
  (Orb Arena, third person), `fps_vault` (Neon Vault, first person with key and locked door), `visual_novel` (Signal Lost),
  `memory_puzzle` (Memory Grid). Racing-lite and a general card/board genre are **not** assembled yet (roadmap; the puzzle genre is a
  memory-match board).
* **Control endpoint** for local automation: loopback JSON-RPC, see below.
* **Branding**: neon editor theme seeded into `~/.config/amerika-engine/godot/editor_settings-4.tres` on first launch (own config
  directory via `XDG_CONFIG_HOME`; your normal Godot settings are untouched), splash image for new projects, project icon.

## The recipe

```json
{
 "recipe_version": 1, "name": "Coin Dash", "genre": "platformer_2d",
 "theme": {"accent": "#ff3d6e", "sky": "#160c2b"},
 "entities": {
  "player": {"role": "player", "shape": "capsule", "size": [22, 30],
             "components": [{"type": "platformer_controller", "speed": 230, "max_jumps": 2}, {"type": "health", "max_health": 3}]},
  "coin":   {"role": "item", "shape": "circle", "components": [{"type": "pickup", "kind": "score", "value": 10}]},
  "hero3d": {"role": "player", "model": "res://models/hero.glb", "model_scale": 1.0}
 },
 "levels": [{"name": "level_1", "tile_size": 32, "rows": ["....", ".P.c", "####"], "legend": {"P": "player", "c": "coin"}}],
 "audio": {"music": {"main": "res://audio/theme.ogg"}, "sfx": {"jump": "res://audio/jump.wav"}},
 "ui": {"title": "COIN DASH", "hud": ["score", "health", "level", "message"]},
 "rules": {"win": {"type": "reach_goal"}, "lose": {"type": "health_zero"}},
 "input": {"dash": ["Shift"]},
 "export_presets": [{"platform": "linux", "path": "build/game.x86_64"}]
}
```

* `genre`: `platformer_2d`, `topdown_2d`, `third_person_3d`, `first_person_3d`, `puzzle` (memory cards, `puzzle` block),
  `visual_novel` (`story` block with nodes, choices, flags).
* Entity `role`: player, enemy, npc, item, hazard, goal, block, prop, spawner. Missing essentials are added per role and reported in the
  assembly `notes` (player: controller + health + camera; enemy: health + contact damage; item: pickup + spin/bob; hazard: contact
  damage; goal: door_trigger).
* Visuals: `sprite {texture, hframes, vframes}` for 2D sheets (Sprite), `model` (.glb/.gltf from Render; origin at the feet,
  `model_offset`, `model_scale`, `model_rotation_y`), otherwise a coloured placeholder (`shape`, `size`, `color`).
* Levels: `rows` (ASCII grid; `#` solid, `.`/space empty, other characters via `legend`) or `objects` (`entity`, `pos` [x,y] or [x,z]
  in 3D, `count`, `step`, `size` for blocks). `tile_size` 32 px (2D) or 2 m (3D); 3D grids get a neon floor and walls of `wall_height`.
* Audio keys: `audio.music` (referenced by `level.music`) and `audio.sfx` (names: jump, pickup, hurt, hit, shoot, win, stomp; a built-in
  beep is used when none is assigned).
* Win rules: `reach_goal`, `collect_all`, `kill_all`, `score` (target), `survive` (seconds), `none`. Lose: `health_zero`, `timer` (seconds).
* Validation = JSON Schema + references (entities, legend characters, audio keys, story nodes) + component parameters, with codes
  `E_SCHEMA E_ENTITY_UNKNOWN E_LEGEND_CHAR E_COMPONENT_DIMS E_PARAM_UNKNOWN E_PARAM_TYPE E_PARAM_ENUM E_NO_PLAYER E_LEVELS_REQUIRED
  E_LEVEL_KIND E_AUDIO_KEY E_STORY_NODE E_STORY_REQUIRED E_PLAYER_NOT_PLACED` (and warning `W_MODEL_MISSING`). The GDScript validator
  (`recipe.gd`) and `amerika_engine/recipe.py` produce the same codes; a test compares them.

### Components

| Component | Dims | What it does | Parameters |
|---|---|---|---|
| `camera_follow` | 2d/3d | Camera that follows the host: a smoothed Camera2D, or a third-person orbit camera (mouse or look_left/look_right keys). | `zoom`, `smoothing`, `distance`, `height`, `pitch_degrees`, `mouse_sensitivity`, `key_orbit_speed`, `limit_to_level` |
| `chase_ai` | 2d/3d (mover) | Chase the nearest body of a group when it is within sight, otherwise stand still. | `target_group`, `speed`, `sight`, `stop_distance`, `gravity` |
| `contact_damage` | 2d/3d | Hurts bodies of the target group while they overlap the host (spikes, enemies). Optional stomp for platformers. | `damage`, `target_group`, `radius`, `interval`, `stomp`, `knockback` |
| `dialogue` | 2d/3d | Talk to an NPC: lines appear in the HUD when the player walks up (enter) or presses interact. | `speaker`, `lines`, `trigger`, `radius`, `line_time`, `loop` |
| `door_trigger` | 2d/3d | Trigger zone: finish the level (goal), go to another level, or show a message. Can require a flag such as a key. | `kind`, `next_level`, `requires_flag`, `message`, `locked_message`, `target_group`, `radius`, `once` |
| `first_person_controller` | 3d (mover) | First-person movement for a CharacterBody3D: WASD, jump, mouse look (or look_left/right keys), creates its own Camera3D at eye height. | `speed`, `acceleration`, `jump_speed`, `gravity`, `eye_height`, `mouse_sensitivity`, `key_look_speed`, `kill_y` |
| `health` | 2d/3d | Hit points with brief invulnerability. The player dying loses the game; other entities score and disappear. | `max_health`, `invulnerable_time`, `score_value`, `remove_on_death`, `death_sfx` |
| `patrol_ai` | 2d/3d (mover) | Walk back and forth around the start position; turns at walls and (in platformers) at ledges. | `axis`, `speed`, `distance`, `gravity`, `turn_at_ledges`, `ledge_probe` |
| `pickup` | 2d/3d | Collectable: coins/score, healing, keys (flags). Removes the host when the target touches it. | `kind`, `value`, `flag`, `sfx`, `target_group`, `radius`, `counts_for_win` |
| `platformer_controller` | 2d (mover) | Side-scrolling movement for a CharacterBody2D: run, jump with coyote time, double jump, gravity, fall-death. | `speed`, `acceleration`, `jump_speed`, `gravity`, `coyote_time`, `max_jumps`, `kill_y` |
| `shooter` | 2d/3d | Fires projectiles. mode=player shoots on the shoot action (aim from movement, mouse or camera); mode=turret shoots automatically at the nearest body of aim_group. | `mode`, `damage`, `projectile_speed`, `cooldown`, `lifetime`, `target_group`, `aim_group`, `max_range`, `color`, `sfx`, `muzzle_offset` |
| `spawner` | 2d/3d | Spawns copies of an entity scene around the host at an interval, up to a maximum alive. | `scene`, `interval`, `max_alive`, `spread`, `initial`, `active_group` |
| `spin_bob` | 2d/3d | Decoration: spin around the up axis and/or float up and down (nice for coins and gems). | `spin_degrees`, `bob_height`, `bob_speed` |
| `sprite_anim` | 2d | Frame animation for a sprite sheet (Sprite export): picks idle / run / jump rows from the host's motion. | `animations`, `fps`, `sprite_path`, `face_motion` |
| `third_person_controller` | 3d (mover) | Camera-relative third-person movement for a CharacterBody3D with jump and gravity; pairs with camera_follow (orbit mode). | `speed`, `acceleration`, `jump_speed`, `gravity`, `turn_speed`, `kill_y` |
| `topdown_controller` | 2d (mover) | Eight-way top-down movement for a CharacterBody2D; the facing vector follows movement (or the mouse when aim_with_mouse is set). | `speed`, `acceleration`, `aim_with_mouse`, `rotate_host` |

Parameters left out use the defaults shown in `components/components.json` (generated from the scripts' `@export` lines by
`amerika_engine/components_gen.py`; a test fails on drift). A value of `0` for sizes/speeds means "automatic for 2D or 3D".

## Tools for the model

All tools are structured, validated, and confined to the project (`res://`): absolute paths, `..`, `.godot/.git/.amerika`, symlinks,
and the plugin's own files are refused (`-32003`). `write_file` only accepts `gd tscn tres json cfg md txt gdshader csv svg`, never
`project.godot`; overwriting needs `overwrite=true`; every write is snapshotted first. GDScript is compiled in a throwaway `GDScript`
(engine errors captured with line numbers through `OS.add_logger`, Godot 4.5+) and refused on failure, so a broken script never lands.

| Tool | RPC method | Notes |
|---|---|---|
| `project_info` | `engine.project.info` | name, path, version, main scene, autoloads, open scenes, running, recipe state |
| `list_files`, `read_file`, `write_file` | `engine.files.*` | |
| `create_scene`, `describe_scene` | `engine.scene.*` | `describe_scene` reads the scene without instantiating it |
| `add_node`, `set_property`, `attach_script` | `engine.node.add`, `engine.node.set_property`, `engine.script.attach` | scene is loaded, edited and re-packed (instances preserved); values are converted to the property type |
| `create_script`, `edit_script` | `engine.script.*` | `edit_script`: exact `{old,new}` patches with parse check; `instruction`/`description` are delegated to the assistant when it is available |
| `get_recipe`, `set_recipe`, `validate_recipe`, `assemble_recipe` | `engine.recipe.*` | `get_recipe` also lists saved recipes and templates |
| `import_model` | `engine.import.model` | `.glb .gltf .png .jpg .webp .svg .wav .ogg .mp3` from `~/Studio` (or `AMERIKA_STUDIO_DIR`) or the project; waits for import (editor: `reimport_files`, else a headless `--import`) |
| `run_project`, `stop_project`, `get_output_and_errors` | `engine.project.run/stop/logs` | the game runs as a child process (exact PID) with piped stdout/stderr; with `frames` it runs headless at fixed 60 fps with a scripted input (`move_right@0.2-2.0,jump@0.6-0.7`) and returns problems and a state report |
| `game_screenshot` | `engine.game.screenshot` | captures the open game window, or runs the game briefly; needs a display |
| `set_input_map`, `set_export_preset` | `engine.input.set`, `engine.export.set_preset` | also recorded in the recipe |
| (undo) | `engine.history.list/undo/redo` | not offered to the model |

The system prompt (`system_prompt.gd`) teaches the loop plan recipe -> assemble -> run -> read errors -> fix -> screenshot -> refine,
GDScript 4 style, the Godot 3 APIs to avoid, composition with components, and embeds the live component catalogue.

## Control endpoint (local automation)

While the editor runs the plugin listens on `127.0.0.1:<free port>` and writes `$XDG_RUNTIME_DIR/amerika/studio-engine.json`
(`{{app,url,token,pid,version}}`, mode 0600, created empty, chmod'ed, then filled; removed on exit). `POST /rpc` JSON-RPC 2.0 with
`Authorization: Bearer <token>`; foreign `Host`/any `Origin` are refused; one call at a time (`-32002` busy). Methods: `app.ping`,
`app.prompt` (runs the chat assistant without asking for approval, since local automation has its own), and every method in the table
above. Errors: `-32601` unknown, `-32602` invalid params, `-32003` path outside project, `-32002` busy, `-32004` not ready, `-32000` other.

`src/os/studio/tools.json` lists the 15 `engine.*` tools (+ `app.prompt`); all are implemented. The extra methods
(`engine.game.screenshot`, `engine.node.*`, `engine.script.attach`, `engine.input.set`, `engine.export.set_preset`,
`engine.recipe.validate`, `engine.history.*`) are **not** in `tools.json` yet, so the MCP server does not expose them; add them there (risk `act`
for writers, `read` for screenshot/validate/list) to give local automation screenshots and node editing.

## The model loop and the bridge

`ai_client.gd` posts non-streaming Messages requests to `http://127.0.0.1:18890/v1/messages` (`AMERIKA_STUDIO_URL`/`AMERIKA_STUDIO_PORT`
override for tests, loopback only) with `Authorization: Bearer <token from $XDG_RUNTIME_DIR/amerika/studio-token>` and
`X-Amerika-App: engine`. No key exists in the plugin. It runs tool_use/tool_result turns (max 30), returns screenshots as image blocks,
retries 429/502/503/529 with `retry-after`, maps `no_api_key` / budget / unreachable to readable messages, trims old tool results, and
never leaves a `tool_use` unanswered when you press Stop.

## Files

```
src/os/engine/addons/amerika_engine/   plugin.gd dock.gd ai_client.gd tools.gd recipe.gd recipe_assembler.gd tscn_writer.gd history.gd runner.gd
                                       script_check.gd log_capture.gd control_server.gd bridge.gd input_map.gd export_presets.gd system_prompt.gd cli.gd
                                       recipe.schema.json components/ runtime/ (game.gd hud.gd level.gd debug_agent.gd vn_runner.gd memory_puzzle.gd)
src/os/engine/{amerika_engine/ (launcher, project, recipe, theme, splash), bin/amerika-engine, templates/, applications/, icons/, NOTICE}
tools/builders/engine.py   tests/test_studio_engine.py   tests/fixtures/engine/
```
Command line (CI): `godot --headless --path P -s res://addons/amerika_engine/cli.gd -- assemble|validate [recipe.json]`, then
`godot --headless --path P --fixed-fps 60 --quit-after 300 -- --amerika-agent --amerika-frames=240 --amerika-input=... --amerika-report=out.json`.
`AmerikaDebug` ignores everything unless `--amerika-agent` is passed, so exported games are unaffected.

## Testing and what is verified

`python3 -m unittest tests.test_studio_engine -q` uses a real headless Godot (found via `AMERIKA_GODOT`, `work/tools/godot`, or PATH; skips
otherwise): schema and component drift, validator parity, golden assembler output (`AMERIKA_UPDATE_GOLDEN=1` rewrites), all templates run
300 frames with no script errors, a scripted playthrough, VN and memory logic, the fake-bridge tool loop in real GDScript, the real editor
(`--editor --headless`) with JSON-RPC against the control endpoint, import confinement, undo, and a real rendered screenshot under the KWin
rig (software/GPU Vulkan; skipped when the rig is missing). Not verifiable here: answers of the real model, long-session quality.
