'use strict';
// Cohnsoft Game Producer desktop app: the same server and UI as the CLI, running inside Electron.
// The server listens on a random loopback port, only this window holds its session cookie, and nothing is exposed on the network.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');

if (process.platform === 'darwin') {
  // Apps started from Finder get a minimal PATH; add the usual places where Godot, Blender and ffmpeg live.
  process.env.PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean).join(':');
}

const smokeIdx = process.argv.indexOf('--smoke-test');
const smokeOut = smokeIdx >= 0 ? process.argv[smokeIdx + 1] : null;
if (smokeOut) app.disableHardwareAcceleration();   // CI machines have no GPU; a hidden window cannot be captured through one
if (smokeOut) process.env.GP_HOME = process.env.GP_HOME || fs.mkdtempSync(path.join(require('os').tmpdir(), 'gp-smoke-'));

app.setPath('userData',path.join(app.getPath('appData'),'AltStack Game Producer'));
let server = null;
let win = null;

async function startServer() {
  const { listen } = require('../src/server');
  server = await listen({ mode: { host: '127.0.0.1', port: 0, hosted: false } });
  return 'http://localhost:' + server.port + '/';
}

function isExternal(url, origin) {
  try { return new URL(url).origin !== new URL(origin).origin; } catch (e) { return true; }
}

function buildMenu(origin) {
  const isMac = process.platform === 'darwin';
  const config = require('../src/config');
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'All Games', accelerator: 'CmdOrCtrl+Shift+H', click: () => win && win.loadURL(origin) },
      { label: 'Show Projects Folder', click: () => shell.openPath(config.paths.projects) },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Cohnsoft Game Producer on GitHub', click: () => shell.openExternal('https://github.com/danecohn/GameProducer') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(origin) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, show: !smokeOut,
    title: 'Cohnsoft Game Producer', icon: path.join(__dirname, '..', 'assets', 'logo.png'), backgroundColor: '#f2f6fb',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (isExternal(url, origin)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
  await win.loadURL(origin);
}

async function smokeTest(origin) {
  const fail = (m) => { console.error('SMOKE FAIL: ' + m); app.exit(1); };
  const status = await (await fetch(origin + 'api/status', { headers: { cookie: await cookieHeader() } })).json().catch(() => null);
  if (!status || !status.version || !status.roster || status.roster.length !== 6) return fail('the server did not answer /api/status with the team roster');
  await win.webContents.executeJavaScript('new Promise((r) => { const t = Date.now(); (function w() { if (document.querySelector("#app .page, #app .studio") || Date.now() - t > 15000) r(); else setTimeout(w, 100); })(); })');
  const text = await win.webContents.executeJavaScript('document.body.innerText');
  if (!/Plug in your key|What are we making|Game Producer/.test(text)) return fail('the page did not render: ' + text.slice(0, 120));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(smokeOut)), { recursive: true });
  fs.writeFileSync(smokeOut, img.toPNG());
  if (!fs.statSync(smokeOut).size) return fail('empty screenshot');
  console.log('SMOKE OK ' + status.version + ' ' + process.platform + '-' + process.arch + ' electron ' + process.versions.electron + ' node ' + process.versions.node);
  app.quit();
}

async function cookieHeader() {
  const cookies = await win.webContents.session.cookies.get({ url: 'http://localhost' });
  return cookies.map((c) => c.name + '=' + c.value).join('; ');
}

if (!app.requestSingleInstanceLock() && !smokeOut) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try {
      const origin = await startServer();
      buildMenu(origin);
      await createWindow(origin);
      if (smokeOut) await smokeTest(origin);
    } catch (e) {
      console.error(e);
      if (smokeOut) return app.exit(1);
      dialog.showErrorBox('Cohnsoft Game Producer could not start', String((e && e.message) || e));
      app.exit(1);
    }
  });
  app.on('activate', async () => { if (!win && server) await createWindow('http://localhost:' + server.port + '/'); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (server) { try { server.close(); } catch (e) { /* exiting */ } } });
}
