// Stands in for "blender -b --python render_worker.py": speaks the same line protocol so the Node side can be tested without Blender.
const MARK = '@@GP@@ ';
const send = (o) => process.stdout.write(MARK + JSON.stringify(o) + '\n');
console.log('Blender chatter that must be ignored');
send({ ready: true, blender: 'fake 0.0' });
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (req.name === 'hang') continue;
    if (req.name === 'crash') process.exit(3);
    if (req.name === 'bad') { send({ id: req.id, ok: false, error: 'invalid input: nope', code: -32602 }); continue; }
    send({ id: req.id, ok: true, result: { echoed: req.name, input: req.input }, images: req.name === 'render_preview' ? ['iVBORw0KGgo='] : [] });
  }
});
process.stdin.on('end', () => process.exit(0));
