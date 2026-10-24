'use strict';
// The team. Names live here and nowhere else, so renaming an agent is a one-line change.
const ROSTER = [
  { id: 'director', name: 'Director', title: 'Game director', studio: null, blurb: 'Talks to you. Plans the game, contracts the team, reviews what comes back.', color: '#ff0058' },
  { id: 'sking', name: 'Sking', title: 'Writer', studio: null, blurb: 'Script, story and dialogue. Keeps the project bible and docs.', color: '#7a4bd6' },
  { id: 'forge', name: 'Forge', title: 'Engine programmer', studio: 'Engine', blurb: 'Builds the game in Godot 4 with AltStack Engine: recipe, scenes, scripts, playtests.', color: '#e8710a' },
  { id: 'molder', name: 'Molder', title: '3D artist', studio: 'Render', blurb: 'Models, materials and rigs in Blender with AltStack Render.', color: '#0e9f8e' },
  { id: 'palette', name: 'Palette', title: '2D artist', studio: 'Sprite', blurb: 'Pixel art, sprite sheets and animations with AltStack Sprite.', color: '#2f9e44' },
  { id: 'noteie', name: 'Noteie', title: 'Composer and sound designer', studio: 'Box', blurb: 'Soundtracks and sound effects with AltStack Box.', color: '#2b7bd4' },
];

const BY_ID = Object.fromEntries(ROSTER.map((a) => [a.id, a]));
const WORKERS = ['forge', 'molder', 'palette', 'noteie', 'sking'];   // agents the Director can contract

module.exports = { ROSTER, BY_ID, WORKERS };
