#!/usr/bin/env python3
"""Regenerate src/studios/generated/render-tools.json from the vendored Render add-on (pure Python, no Blender needed).
The Node server reads the JSON; the Blender worker (studio/render_worker.py) imports the real add-on."""
import importlib.util, json, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('toolspecs', root / 'vendor/render/src/amerika_render/toolspecs.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
out = root / 'src/studios/generated/render-tools.json'
out.write_text(json.dumps({'tools': m.SPECS, 'review_always': sorted(getattr(m, 'REVIEW_ALWAYS', []))}, indent=1) + '\n')
print(f'wrote {out.relative_to(root)} ({len(m.SPECS)} tools)')
