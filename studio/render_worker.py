"""Headless Blender worker for AltStack Render (Molder's hands).

Started by the Game Producer server as:
    blender -b --factory-startup -noaudio --python studio/render_worker.py -- --addon <dir containing amerika_render/> --project <dir> [--workspace <file.blend>]

Protocol (line based, over stdin/stdout). Blender prints its own chatter on stdout, so every message we send is
prefixed with "@@GP@@ ":
    in : {"id": 1, "name": "create_primitive", "input": {...}}
    out: {"id": 1, "ok": true, "result": {...}, "images": ["<base64 png>", ...]}
    out: {"id": 1, "ok": false, "error": "...", "code": -32000}
The tools are the real AltStack Render tools (vendor/render): validated, project-confined, game-ready checks included.
"""
import base64
import json
import os
import sys
import traceback

MARK = '@@GP@@ '


def send(obj):
    sys.stdout.write(MARK + json.dumps(obj) + '\n')
    sys.stdout.flush()


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith('--') and i + 1 < len(argv):
            out[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    return out


def main():
    args = parse_args()
    addon_dir = args.get('addon')
    project = args.get('project')
    workspace = args.get('workspace')
    if not addon_dir or not project:
        send({'ready': False, 'error': 'missing --addon or --project'})
        return 2
    sys.path.insert(0, addon_dir)
    import bpy
    from amerika_render import config, tools, toolspecs  # noqa: E402  (the real add-on code)

    config.PROJECT_OVERRIDE = project
    os.makedirs(project, exist_ok=True)
    reopened = False
    if workspace and os.path.exists(workspace):
        try:
            bpy.ops.wm.open_mainfile(filepath=workspace)
            reopened = True
        except Exception as e:  # a damaged workspace must not stop the worker
            send({'note': f'could not reopen the workspace: {e}'})
    if not reopened:
        bpy.ops.wm.read_factory_settings(use_empty=True)   # an empty scene: no default cube, camera or light

    send({'ready': True, 'blender': bpy.app.version_string, 'tools': sorted(toolspecs.BY_NAME)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            send({'id': None, 'ok': False, 'error': 'bad json'})
            continue
        rid = req.get('id')
        name = req.get('name')
        if name == 'quit':
            send({'id': rid, 'ok': True, 'result': {'bye': True}})
            return 0
        try:
            out = tools.call(name, req.get('input') or {})
        except Exception as e:  # tools.call never raises, but be sure the loop survives anything
            send({'id': rid, 'ok': False, 'error': f'worker error: {type(e).__name__}: {e}', 'detail': traceback.format_exc()[-1200:]})
            continue
        spec = toolspecs.BY_NAME.get(name) or {}
        if out.get('ok'):
            if workspace and spec.get('risk') != 'read':
                try:
                    bpy.ops.wm.save_as_mainfile(filepath=workspace, copy=True, compress=True)
                except Exception:
                    pass
            send({'id': rid, 'ok': True, 'result': out.get('result'), 'images': [base64.b64encode(p).decode() for p in out.get('images') or []]})
        else:
            send({'id': rid, 'ok': False, 'error': out.get('error'), 'code': out.get('code'), 'detail': out.get('detail')})
    return 0


if __name__ == '__main__':
    code = main()
    sys.stdout.flush()
    os._exit(code or 0)
