# Hosting (Railway)

The same app runs hosted. It refuses to listen publicly without an access token.

Service variables:

| Variable | Meaning |
|---|---|
| `GP_ACCESS_TOKEN` | **required.** Long random string; the login page asks for it. |
| `GP_PROVIDER` | `anthropic` or `openai` |
| `GP_API_KEY` | the one key (then the browser cannot change it) |
| `GP_HOME` | `/data` (set by the image); attach a Railway volume at `/data` |

Build: the repo's `Dockerfile` (Godot included; `--build-arg WITH_BLENDER=1` adds Blender). `railway.json` points Railway at it. Hosted mode disables Play and tool installs; users download the zipped Godot project. Screenshots need a display and are unavailable on a server; playtests use headless state reports instead.
