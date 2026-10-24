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

## Desktop releases and the downloads page

`/downloads.html` (public, even on a hosted server) reads the latest GitHub release of `GP_RELEASES_REPO` (default `danecohn/GameProducer`) and offers an installer only when its `.sha256` is published beside it. Cut a release by pushing a tag (`git tag v0.1.0 && git push origin v0.1.0`) or by running the **Release desktop apps** workflow with *publish* ticked. It publishes nothing unless all six platforms passed the packaged-app launch test.

macOS signing and notarization (removes the "damaged" / "cannot be opened" block that Gatekeeper puts on downloaded, un-notarized apps) needs an Apple Developer Program membership. Add these repository secrets and the workflow does the rest:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | base64 of the *Developer ID Application* certificate (.p12) |
| `MAC_CSC_KEY_PASSWORD` | the .p12 password |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character team id |
