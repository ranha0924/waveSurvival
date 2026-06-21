// Electron main process for the 굿판 — Wave Survival desktop build.
//
// The game is a pure static site (index.html + js/ + assets/). Loading it via
// file:// would break `fetch('assets/audio/...')` in audio.js — Chromium blocks
// fetch over the file:// scheme, so the game would silently fall back to the
// procedural synth and lose its real SFX samples.
//
// To match the README's recommended `python3 -m http.server` setup exactly, we
// spin up a tiny static HTTP server bound to 127.0.0.1 on a random free port,
// using only Node built-ins (no extra dependencies), and point the window at it.
// Co-op still talks to the external Render relay over wss://, which works the
// same regardless of how the page itself is served.

const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Project root = one level up from this file (where index.html lives). Works
// both unpacked (dev) and inside the asar archive (packaged), since Node's fs
// reads transparently from asar.
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        // Strip query string, decode, and normalize to prevent path traversal.
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const safePath = path
          .normalize(urlPath)
          .replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(ROOT, safePath);

        // Ensure the resolved path stays inside ROOT.
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
          });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500);
        res.end('Server error');
      }
    });

    server.on('error', reject);
    // Port 0 → OS assigns a free port.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(port);
    });
  });
}

async function createWindow() {
  const port = await startServer();

  const win = new BrowserWindow({
    width: 1024,
    height: 680,
    backgroundColor: '#000000',
    title: 'Wave Survival',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links (fonts, etc. are loaded inline; this guards any future
  // anchor tags) in the system browser rather than a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`http://127.0.0.1:${port}/index.html`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
