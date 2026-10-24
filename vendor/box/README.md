# MakBox

**MakBox**: a desktop chiptune maker with an AI composer, built on BeepBox by John Nesky (MIT, https://github.com/johnnesky/beepbox; pinned commit in src/beepbox.lock.json). Not affiliated with beepbox.co.

Developed by **Cherry Blossom LLC** for **Makk OS** (Ubuntu 26.10 ARM64): describe what you want, and the built-in assistant (Anthropic Claude, through your own API key) builds it. The key is stored in your login keyring by Studio and never reaches the app; see `docs/STUDIO-ARCHITECTURE.md` and `docs/README.md`. Local automation uses the existing Studio bridge; installing OpenClaw is not required.



Source layout: `src/` (installed under `/usr/share`), `tools/builders/box.py` (Debian package builder used by the Amerika OS build), `tests/`, `docs/box.md`.
Licence: GPL-3.0-only for Amerika code (see `LICENSE`); third-party licences are listed in `src/NOTICE`.
