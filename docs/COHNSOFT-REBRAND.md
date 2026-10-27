# Cohnsoft Game Producer

Canonical identity and local Cohn Sans/Golden Gate resources are vendored unchanged under web/brand/cohnsoft/ with pinned commit and SHA-256 provenance. Studio avatars reuse original Cohnsoft Sprite exports with editable sources under assets/product-icons/.

Full product prefixes update the web, desktop and CLI interfaces, agent product descriptions and first-party docs. Director, Sking, Forge, Molder, Palette and Noteie retain their names. Upstream Godot/Blender/BeepBox notices remain intact.

Preserved: GP_HOME and ~/AltStack/GameProducer paths, Electron installed profile, API routes, project/recipe/song/sprite formats, provider settings, environment names, tool-install checksums and existing release asset names. New version 0.1.5 uses the existing six-platform validation/publish gate, which preserves already-published releases.

Validation: 55 tests pass; one environment-dependent test is skipped. Tests exercise project/crew state, cancellation, provider wire adapters, tools, HTTP auth and release filtering. Local mock-provider browser preview makes no paid AI calls. Native release jobs remain separate from web deployment verification.
