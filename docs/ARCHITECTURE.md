# Architecture

```
Browser UI ──HTTP/SSE── server.js ── Crew (one per project)
                                      ├─ Director / Sking chats  (agents/loop.js tool-use loop)
                                      ├─ contracts → Forge | Molder | Palette | Noteie | Sking (parallel, one at a time per agent)
                                      ├─ decisions (Producer approvals), budget guard, usage, events
                                      └─ studios:  engine.js ─ Godot CLI + Engine plugin (vendor/engine)
                                                   render.js ─ blender -b + studio/render_worker.py (vendor/render add-on code)
                                                   sprite.js ─ vendor/sprite modules in-process
                                                   box.js    ─ vendor/box modules + BeepBox synth in a vm
```

- **One key.** `llm/index.js` holds the single credential (file 0600, or `GP_PROVIDER` + `GP_API_KEY`). `llm/anthropic.js` speaks the Messages API (prompt-cache breakpoints on system, tools and the newest turn); `llm/openai.js` converts the same internal Anthropic-style blocks to Chat Completions (tool-result images become a following user message; array schemas get `items`).
- **Loop** (`agents/loop.js`): call model, run all requested tools concurrently, return results, repeat. Old images and bulky tool output are trimmed; a terminal tool (`submit_deliverable`) ends a contract; Producer notes are injected into the next turn; abort is honoured everywhere.
- **Contracts**: Director calls `contract_agent` (several per reply = parallel). Workers do not see the chat, only the brief, the bible digest and the asset list, and answer with a structured deliverable.
- **Bible** (`bible/*.md`): Sking's documents; every agent gets BIBLE.md in its first message.
- **Persona prompts** (`agents/prompts.js`) embed each studio's own manual read from `vendor/` (Sprite and Box prompts, Render's prompt, Engine's GDScript rules and live component catalogue), so they cannot drift.
- **Safety**: all file access is confined to the project (`util.confine`, symlink-safe); GDScript is parse-checked by Godot before it is written and refused if it uses OS execution, networking or paths outside `res://`/`user://`; Blender Python passes Render's AST checks and the Producer's approval; the server is loopback-only with a session cookie, Host/Origin checks and a CSP; hosted mode requires `GP_ACCESS_TOKEN`.
- **Demo crew** (`llm/mock.js`): a scripted stand-in for the model that makes real tool calls. It powers `demo` mode and most tests.

## Updating the bundled tools

`scripts/sync-vendor.sh` re-copies the headless parts of the four repos and records commits in `vendor/VENDOR.json`. `scripts/gen-render-tools.py` regenerates `src/studios/generated/render-tools.json` from Render's tool specs.

## Not verified

Real-model behaviour: no provider key was available while building, so quality of the agents' decisions and the OpenAI/Anthropic requests against the live APIs were tested against local fakes of their wire formats only. Default OpenAI model ids are guesses; change them in Settings. The Dockerfile has not been built.
