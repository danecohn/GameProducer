'use strict';
// What exists in a project right now, in the compact form agents (and the UI) need.
const fs = require('fs');
const path = require('path');
const { walk } = require('../util');

function inventory(project) {
  const sp = walk(project.paths.sprites);
  const md = walk(project.paths.models);
  const au = walk(project.paths.audio);
  const rel = (kind, p) => 'assets/' + kind + '/' + p;
  const music = {};
  for (const f of au.filter((x) => x.path.startsWith('music/'))) {
    const [, name, ...rest] = f.path.split('/');
    (music[name] = music[name] || []).push(rest.join('/'));
  }
  return {
    sprites: {
      editable: sp.filter((f) => f.path.endsWith('.asprite.json')).map((f) => f.path.replace(/\.asprite\.json$/, '')),
      images: sp.filter((f) => /\.(png|gif)$/i.test(f.path)).map((f) => rel('sprites', f.path)),
      sheets: sp.filter((f) => f.path.endsWith('.tres') || f.path.endsWith('.atlas.gd') || (f.path.endsWith('.json') && !f.path.endsWith('.asprite.json'))).map((f) => rel('sprites', f.path)),
    },
    models: {
      files: md.filter((f) => /\.(glb|gltf)$/i.test(f.path)).map((f) => ({ path: rel('models', f.path), bytes: f.size })),
      previews: md.filter((f) => /\.(png|jpg)$/i.test(f.path)).map((f) => rel('models', f.path)),
      blends: md.filter((f) => f.path.endsWith('.blend')).map((f) => rel('models', f.path)),
    },
    audio: {
      music: Object.keys(music).map((name) => ({ name, dir: 'assets/audio/music/' + name, files: music[name] })),
      sfx: au.filter((f) => f.path.startsWith('sfx/')).map((f) => rel('audio', f.path)),
      songs: au.filter((f) => f.path.startsWith('songs/')).map((f) => f.path.replace(/^songs\//, '').replace(/\.beepbox\.json$/, '')),
    },
  };
}

function counts(inv) {
  return { sprites: inv.sprites.images.length, models: inv.models.files.length, music: inv.audio.music.length, sfx: inv.audio.sfx.length };
}

module.exports = { inventory, counts };
