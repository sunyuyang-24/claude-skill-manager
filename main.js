const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { loadConfig, saveConfig } = require('./lib/config-store');

// ── CLI argument handling ───────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.filter(a => !a.startsWith('--allow-file') && !a.startsWith('--enable'));
  const opts = { port: 0, project: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) { opts.project = args[i + 1]; i++; }
    else if (args[i] === '--port' && args[i + 1]) { opts.port = parseInt(args[i + 1], 10); i++; }
  }
  return opts;
}

// ── Server setup ────────────────────────────────────────────────────────
let server = null;
let serverPort = null;

async function startServer(config, port) {
  const { startServer: _startServer } = require('./lib/server');
  server = await _startServer(config, port);
  serverPort = server.address().port;
}

// ── Window ──────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Code Skill Manager',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Build menu
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        { label: 'Rescan Skills', accelerator: 'F5', click: () => {
          mainWindow.webContents.executeJavaScript('fetch("/api/scan", {method:"POST"}).then(()=>location.reload())');
        }},
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools', accelerator: 'F12' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

// ── App lifecycle ───────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const cliArgs = parseArgs();
  const config = loadConfig();

  if (cliArgs.project) {
    config.projectPath = path.resolve(cliArgs.project);
    config.projectSkillsDir = path.join(config.projectPath, '.claude', 'skills');
    saveConfig(config);
  }

  await startServer(config, cliArgs.port);
  createWindow();

  console.log(`Skill Manager running at http://localhost:${serverPort}`);
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
