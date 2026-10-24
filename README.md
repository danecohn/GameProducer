# AltStack Game Producer

An agentic game studio in one app. **You are the Producer.** You describe the game; **Director** plans it, contracts a team of specialist agents, reviews what comes back and checks in with you; the team builds the game with the four AltStack tools, bundled together.

| Agent | Role | Drives |
|---|---|---|
| **Director** | Talks to you. Plans, contracts, reviews, reports. | the whole team |
| **Sking** | Writer. Script, story, dialogue; keeps the project bible. You can also talk to Sking directly. | `bible/` |
| **Forge** | Engine programmer. | AltStack **Engine** (Godot 4, game recipes, headless playtests) |
| **Molder** | 3D artist. | AltStack **Render** (Blender) |
| **Palette** | 2D artist. | AltStack **Sprite** (pixel art, sheets, animation) |
| **Noteie** | Composer and sound designer. | AltStack **Box** (BeepBox chiptune, looping music, SFX) |

**One key runs everything.** Paste an OpenAI or Anthropic key once; Director and every specialist use it. It is stored on your machine (mode 0600), sent only to your provider, and never reaches the browser.

## Run it

```bash
node bin/game-producer.js          # Node 20+, no npm install needed (zero dependencies)
node bin/game-producer.js demo     # scripted demo crew: no key, no spend, real tools
node bin/game-producer.js doctor   # what is installed
node bin/game-producer.js install godot     # official build, SHA-512 verified (Forge)
node bin/game-producer.js install blender   # official build, SHA-256 verified (Molder)
```

Open the page it prints, plug in your key, describe a game. Palette (Sprite) and Noteie (Box) are built in. Forge needs Godot and Molder needs Blender; without them the agents report the blocker honestly and keep working on what they can (Settings has one-click install buttons).

## How a game gets made

1. You describe the game. Director may ask one question at a time, with options and a recommendation.
2. Sking writes the bible; Director posts a plan on the production board.
3. Director contracts agents **in parallel** (art, music, engine skeleton at once). Each contract is a card in the transcript with live progress and, when done, the agent's deliverable.
4. Director reviews (it looks at the art), sends corrections, has Forge integrate assets and playtest.
5. You get a playable Godot project (Play button locally, zip download anywhere), and decide what's next.

You stay in control: questions and approvals appear as cards, you can add notes while the team works, **Stop** halts everything, a token budget pauses the team and asks before overspending, and Molder's Blender Python is shown to you before it runs.

## Layout

```
bin/            CLI
src/            server, crew (orchestrator), agents (loop, prompts, tools), llm (Anthropic, OpenAI, demo), studios (adapters), projects
studio/         render_worker.py: the headless Blender worker
vendor/         pinned, headless parts of AltStack Engine, Render, Sprite, Box  (scripts/sync-vendor.sh)
web/            the UI (no build step)
test/           node:test suite
```

Projects live in `~/AltStack/GameProducer/projects/<game>/` (`GP_HOME` to change): `bible/`, `assets/{sprites,models,audio}/`, `game/` (the Godot project), `.producer/` (conversations, events, state).

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DEPLOY.md](docs/DEPLOY.md). Tests: `npm test` (Godot/Blender tests run when those are installed, otherwise skip).

Licence: GPL-3.0-only. Third-party notices: [NOTICE.md](NOTICE.md).
