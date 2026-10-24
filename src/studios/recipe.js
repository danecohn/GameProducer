'use strict';
// Game Recipe validation in JavaScript. A port of vendor/engine's recipe.py (same error codes), so Forge gets
// instant, precise feedback without starting Godot. The GDScript validator inside Godot stays the final authority.
const fs = require('fs');
const path = require('path');

const ADDON = path.join(__dirname, '..', '..', 'vendor', 'engine', 'src', 'addons', 'amerika_engine');
const schema = JSON.parse(fs.readFileSync(path.join(ADDON, 'recipe.schema.json'), 'utf8'));
const components = JSON.parse(fs.readFileSync(path.join(ADDON, 'components', 'components.json'), 'utf8')).components;

const GAMEPLAY = ['platformer_2d', 'topdown_2d', 'third_person_3d', 'first_person_3d'];
const DIMS = { platformer_2d: '2d', topdown_2d: '2d', third_person_3d: '3d', first_person_3d: '3d' };

function typeOk(v, t) {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'null': return v === null;
    default: return false;
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The JSON Schema subset the recipe schema uses. Returns ["path: message", ...]. */
function validateSchema(value, sch, root, p) {
  root = root || sch; p = p || '$';
  if (sch.$ref) {
    let node = root;
    for (const part of sch.$ref.replace(/^#\//, '').split('/')) node = node[part];
    return validateSchema(value, node, root, p);
  }
  const errs = [];
  if ('const' in sch && !same(value, sch.const)) errs.push(`${p}: must be ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.some((e) => same(e, value))) errs.push(`${p}: must be one of ${JSON.stringify(sch.enum)}`);
  const t = sch.type;
  if (t && !(Array.isArray(t) ? t.some((x) => typeOk(value, x)) : typeOk(value, t))) { errs.push(`${p}: expected ${t}`); return errs; }
  if (typeof value === 'string') {
    if (sch.minLength !== undefined && value.length < sch.minLength) errs.push(`${p}: shorter than ${sch.minLength}`);
    if (sch.maxLength !== undefined && value.length > sch.maxLength) errs.push(`${p}: longer than ${sch.maxLength}`);
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) errs.push(`${p}: does not match ${sch.pattern}`);
  }
  if (typeof value === 'number') {
    if (sch.minimum !== undefined && value < sch.minimum) errs.push(`${p}: below minimum ${sch.minimum}`);
    if (sch.maximum !== undefined && value > sch.maximum) errs.push(`${p}: above maximum ${sch.maximum}`);
    if (sch.exclusiveMinimum !== undefined && value <= sch.exclusiveMinimum) errs.push(`${p}: must be greater than ${sch.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (sch.minItems !== undefined && value.length < sch.minItems) errs.push(`${p}: needs at least ${sch.minItems} items`);
    if (sch.maxItems !== undefined && value.length > sch.maxItems) errs.push(`${p}: more than ${sch.maxItems} items`);
    if (sch.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${p}: items must be unique`);
    if (sch.items) value.forEach((item, i) => errs.push(...validateSchema(item, sch.items, root, `${p}[${i}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of sch.required || []) if (!(r in value)) errs.push(`${p}: missing "${r}"`);
    if (sch.minProperties !== undefined && Object.keys(value).length < sch.minProperties) errs.push(`${p}: needs at least ${sch.minProperties} properties`);
    const props = sch.properties || {};
    for (const [key, sub] of Object.entries(value)) {
      if (sch.propertyNames) errs.push(...validateSchema(key, sch.propertyNames, root, `${p}.${key} (key)`));
      if (key in props) errs.push(...validateSchema(sub, props[key], root, `${p}.${key}`));
      else if (sch.additionalProperties === false) errs.push(`${p}: unknown property "${key}"`);
      else if (sch.additionalProperties && typeof sch.additionalProperties === 'object') errs.push(...validateSchema(sub, sch.additionalProperties, root, `${p}.${key}`));
    }
  }
  return errs;
}

const issue = (code, p, message, severity) => ({ code, path: p, message, severity: severity || 'error' });

function paramOk(spec, v) {
  switch (spec.type) {
    case 'number': return typeof v === 'number';
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'string': case 'color': return typeof v === 'string';
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'string_array': return Array.isArray(v) && v.every((x) => typeof x === 'string');
    default: return true;
  }
}

/** Returns a list of issues {code, path, message, severity}. No errors = the recipe assembles. `gameDir` enables the model-file check. */
function validate(recipe, gameDir) {
  const issues = [];
  for (const e of validateSchema(recipe, schema)) {
    const i = e.indexOf(': ');
    issues.push(issue('E_SCHEMA', e.slice(0, i), e.slice(i + 2)));
  }
  if (issues.length) return issues;
  const genre = recipe.genre, dims = DIMS[genre];
  const entities = recipe.entities || {};
  const music = (recipe.audio && recipe.audio.music) || {};
  for (const [key, ent] of Object.entries(entities)) {
    (ent.components || []).forEach((c, i) => {
      const base = `entities.${key}.components[${i}]`;
      const spec = components[c.type];
      if (!spec || spec.internal) { issues.push(issue('E_COMPONENT_UNKNOWN', base, `unknown component "${c.type}" (known: ${Object.keys(components).filter((k) => !components[k].internal).join(', ')})`)); return; }
      if (dims && !spec.dims.includes(dims)) issues.push(issue('E_COMPONENT_DIMS', base, `${c.type} does not support ${dims.toUpperCase()} games`));
      for (const [pk, pv] of Object.entries(c)) {
        if (pk === 'type') continue;
        const ps = spec.params[pk];
        if (!ps) issues.push(issue('E_PARAM_UNKNOWN', `${base}.${pk}`, `${c.type} has no parameter "${pk}" (has: ${Object.keys(spec.params).join(', ')})`));
        else if (!paramOk(ps, pv)) issues.push(issue('E_PARAM_TYPE', `${base}.${pk}`, `expected ${ps.type}`));
        else if (ps.enum && !ps.enum.includes(pv)) issues.push(issue('E_PARAM_ENUM', `${base}.${pk}`, `must be one of ${JSON.stringify(ps.enum)}`));
        if (c.type === 'spawner' && pk === 'scene' && typeof pv === 'string' && !pv.startsWith('res://') && !(pv in entities)) issues.push(issue('E_ENTITY_UNKNOWN', `${base}.scene`, `spawner scene "${pv}" is not an entity`));
      }
    });
    if (ent.model && gameDir) {
      const rel = ent.model.replace(/^res:\/\//, '');
      if (!fs.existsSync(path.join(gameDir, rel))) issues.push(issue('W_MODEL_MISSING', `entities.${key}.model`, `${ent.model} not found; a placeholder is used`, 'warning'));
    }
    if (ent.sprite && ent.sprite.texture && gameDir) {
      const rel = String(ent.sprite.texture).replace(/^res:\/\//, '');
      if (!fs.existsSync(path.join(gameDir, rel))) issues.push(issue('W_SPRITE_MISSING', `entities.${key}.sprite.texture`, `${ent.sprite.texture} not found; a placeholder is used (import_asset it first)`, 'warning'));
    }
  }
  if (GAMEPLAY.includes(genre)) {
    if (!(recipe.levels || []).length) issues.push(issue('E_LEVELS_REQUIRED', 'levels', `${genre} games need at least one level`));
    if (!Object.values(entities).some((e) => e.role === 'player')) issues.push(issue('E_NO_PLAYER', 'entities', 'no entity with role "player"'));
    (recipe.levels || []).forEach((level, li) => {
      const base = `levels[${li}]`;
      if (!level.rows && !level.objects) issues.push(issue('E_LEVEL_KIND', base, 'a level needs "rows" (grid) or "objects"'));
      const legend = level.legend || {};
      for (const [ch, ek] of Object.entries(legend)) if (ek !== 'block' && !(ek in entities)) issues.push(issue('E_ENTITY_UNKNOWN', `${base}.legend.${ch}`, `unknown entity "${ek}"`));
      (level.rows || []).forEach((row, ri) => {
        for (const ch of new Set(row.split(''))) if (!(ch in legend) && !'#. '.includes(ch)) issues.push(issue('E_LEGEND_CHAR', `${base}.rows[${ri}]`, `character "${ch}" is not in the legend`));
      });
      (level.objects || []).forEach((o, oi) => { if (o.entity !== 'block' && !(o.entity in entities)) issues.push(issue('E_ENTITY_UNKNOWN', `${base}.objects[${oi}]`, `unknown entity "${o.entity}"`)); });
      if (level.music && !(level.music in music)) issues.push(issue('E_AUDIO_KEY', `${base}.music`, `no audio.music entry "${level.music}"`));
    });
    const first = (recipe.levels || [])[0];
    if (first) {
      const placed = new Set((first.objects || []).map((o) => o.entity));
      const legend = first.legend || {};
      for (const row of first.rows || []) for (const ch of row) if (legend[ch]) placed.add(legend[ch]);
      const players = Object.keys(entities).filter((k) => entities[k].role === 'player');
      if (players.length && !players.some((k) => placed.has(k))) issues.push(issue('E_PLAYER_NOT_PLACED', 'levels[0]', 'the first level never places the player entity'));
    }
  }
  if (genre === 'visual_novel') {
    const story = recipe.story;
    if (!story) issues.push(issue('E_STORY_REQUIRED', 'story', 'visual_novel games need a story'));
    else {
      const nodes = story.nodes || {};
      if (!(story.start in nodes)) issues.push(issue('E_STORY_NODE', 'story.start', `unknown node "${story.start}"`));
      for (const [nid, n] of Object.entries(nodes)) {
        if (n.next && !(n.next in nodes)) issues.push(issue('E_STORY_NODE', `story.nodes.${nid}.next`, `unknown node "${n.next}"`));
        (n.choices || []).forEach((ch, ci) => { if (!(ch.goto in nodes)) issues.push(issue('E_STORY_NODE', `story.nodes.${nid}.choices[${ci}]`, `unknown node "${ch.goto}"`)); });
      }
    }
  }
  return issues;
}

const errors = (issues) => issues.filter((i) => i.severity === 'error');
const format = (i) => `${i.code} ${i.path}: ${i.message}`;

/** One-line-per-component catalogue for Forge's system prompt (mirrors system_prompt.gd). */
function catalogue() {
  return Object.keys(components).sort().filter((n) => !components[n].internal).map((n) => {
    const c = components[n];
    const params = Object.entries(c.params).map(([k, s]) => `${k}=${s.enum ? s.default + ' of ' + s.enum.join('/') : s.default}`);
    return `- ${n} [${c.dims.join(',')}${c.mover ? ', mover' : ''}]: ${c.summary} Params: ${params.join('; ')}`;
  }).join('\n');
}

module.exports = { validate, validateSchema, errors, format, catalogue, components, schema, GAMEPLAY };
