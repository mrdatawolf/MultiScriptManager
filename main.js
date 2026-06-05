const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const Store = require('electron-store');

const store = new Store();

// Map of scriptKey -> { process, output: string[], exitCode }
const running = new Map();

// Simple glob: only * is special (matches any chars within a filename, not /)
function globMatch(pattern, name) {
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$'
  );
  return re.test(name);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Multi Script Manager',
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Settings ────────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => store.store);

ipcMain.handle('settings:set', (_e, updates) => {
  store.set(updates);
  return store.store;
});

ipcMain.handle('settings:clear', () => {
  store.clear();
  return store.store;
});

ipcMain.handle('settings:pickFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ── Script discovery ─────────────────────────────────────────────────────────

const appRealPath = (() => { try { return fs.realpathSync(__dirname); } catch { return __dirname; } })();

ipcMain.handle('scripts:scan', () => {
  const parentFolder = store.get('parentFolder', '');
  if (!parentFolder) return [];

  const isWindows = process.platform === 'win32';
  const patterns = isWindows
    ? store.get('windowsPatterns', ['start*.bat', 'start*.ps1', 'run*.bat', 'run*.ps1'])
    : store.get('unixPatterns', ['start*.sh', 'run*.sh', 'dev*.sh', 'server*.sh']);

  const excludedFolders = store.get('excludedFolders', []);

  let entries;
  try {
    entries = fs.readdirSync(parentFolder, { withFileTypes: true });
  } catch {
    return [];
  }

  const folders = entries.filter(e => e.isDirectory()).map(e => e.name);

  return folders.map(folderName => {
    const folderPath = path.join(parentFolder, folderName);

    // Skip the app's own folder (by real path) and any user-excluded folders
    if (excludedFolders.includes(folderName)) return null;
    try {
      if (fs.realpathSync(folderPath) === appRealPath) return null;
    } catch { /* ignore stat errors */ }
    let scripts;
    try {
      scripts = fs.readdirSync(folderPath);
    } catch {
      scripts = [];
    }

    const matched = scripts
      .filter(f => patterns.some(p => globMatch(p, f)))
      .map(scriptFile => {
        const key = `${folderName}::${scriptFile}`;
        const proc = running.get(key);
        return {
          key,
          folderName,
          folderPath,
          scriptFile,
          status: proc ? 'running' : 'stopped',
          exitCode: proc?.exitCode ?? null,
          output: proc?.output.slice(-50) ?? [],
        };
      });

    return { folderName, folderPath, scripts: matched };
  }).filter(f => f && f.scripts.length > 0);
});

// ── Process management ───────────────────────────────────────────────────────

ipcMain.handle('process:start', (event, { key, folderPath, scriptFile }) => {
  const existing = running.get(key);
  if (existing?.process) return { ok: false, reason: 'already running' };

  const isWindows = process.platform === 'win32';
  let cmd, args;

  if (isWindows) {
    if (scriptFile.endsWith('.ps1')) {
      cmd = 'powershell';
      args = ['-ExecutionPolicy', 'Bypass', '-File', scriptFile];
    } else {
      cmd = 'cmd';
      args = ['/c', scriptFile];
    }
  } else {
    cmd = 'bash';
    args = [scriptFile];
  }

  const child = spawn(cmd, args, {
    cwd: folderPath,
    env: { ...process.env },
    shell: false,
    detached: true,  // own process group so we can kill the whole tree
  });

  const entry = { process: child, output: [], exitCode: null, stoppedByUser: false };
  running.set(key, entry);

  // Persist running state
  const persisted = store.get('lastRunning', []);
  if (!persisted.includes(key)) {
    store.set('lastRunning', [...persisted, key]);
  }

  const win = BrowserWindow.getAllWindows()[0];

  const onData = (chunk) => {
    const lines = chunk.toString().split('\n');
    entry.output.push(...lines.filter(l => l !== ''));
    if (entry.output.length > 500) entry.output.splice(0, entry.output.length - 500);
    win?.webContents.send('process:output', { key, lines });
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('close', (code) => {
    entry.exitCode = code;
    entry.process = null;
    const current = store.get('lastRunning', []);
    store.set('lastRunning', current.filter(k => k !== key));
    // User-initiated stops aren't crashes even though exit code is non-zero
    const status = (entry.stoppedByUser || code === 0) ? 'stopped' : 'crashed';
    win?.webContents.send('process:stopped', { key, code, status });
  });

  return { ok: true };
});

ipcMain.handle('process:stop', async (_e, { key, force }) => {
  const entry = running.get(key);
  if (!entry?.process) return { ok: false, reason: 'not running' };

  const pid = entry.process.pid;

  const killGroup = (sig) => {
    if (process.platform === 'win32') {
      // Kill entire process tree on Windows
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { shell: false });
    } else {
      try {
        process.kill(-pid, sig);  // negative PID = kill the whole process group
      } catch {
        try { entry.process.kill(sig); } catch {}  // fallback if group is already gone
      }
    }
  };

  entry.stoppedByUser = true;

  if (force) {
    killGroup('SIGKILL');
  } else {
    killGroup('SIGTERM');
    // Escalate to SIGKILL after 5s if still alive
    setTimeout(() => {
      if (entry.process) killGroup('SIGKILL');
    }, 5000);
  }

  return { ok: true };
});

ipcMain.handle('process:output', (_e, { key }) => {
  return running.get(key)?.output ?? [];
});

ipcMain.handle('process:lastRunning', () => {
  return store.get('lastRunning', []);
});

// ── Login item (start on login) ──────────────────────────────────────────────

const loginItemName = 'MultiScriptManager';

ipcMain.handle('settings:getLoginItem', () => {
  if (process.platform === 'win32') {
    const result = spawnSync('reg', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v', loginItemName,
    ], { encoding: 'utf8' });
    return { enabled: result.status === 0 };
  }
  if (process.platform === 'linux') {
    const desktopFile = path.join(
      app.getPath('home'), '.config', 'autostart', 'multi-script-manager.desktop'
    );
    return { enabled: fs.existsSync(desktopFile) };
  }
  return { enabled: false };
});

ipcMain.handle('settings:setLoginItem', (_e, { enabled }) => {
  if (process.platform === 'win32') {
    const startBat = path.join(appRealPath, 'start.bat');
    if (enabled) {
      spawnSync('reg', [
        'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v', loginItemName,
        '/t', 'REG_SZ',
        '/d', `cmd.exe /c "${startBat}"`,
        '/f',
      ], { encoding: 'utf8' });
    } else {
      spawnSync('reg', [
        'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v', loginItemName, '/f',
      ], { encoding: 'utf8' });
    }
  } else if (process.platform === 'linux') {
    const autostartDir = path.join(app.getPath('home'), '.config', 'autostart');
    const desktopFile = path.join(autostartDir, 'multi-script-manager.desktop');
    if (enabled) {
      const startSh = path.join(appRealPath, 'start.sh');
      fs.mkdirSync(autostartDir, { recursive: true });
      try { fs.chmodSync(startSh, 0o755); } catch {}
      fs.writeFileSync(desktopFile, [
        '[Desktop Entry]',
        'Type=Application',
        `Exec="${startSh}"`,
        'Hidden=false',
        'NoDisplay=false',
        'X-GNOME-Autostart-enabled=true',
        'Name=MultiScriptManager',
        'Comment=Start MultiScriptManager on login',
        '',
      ].join('\n'), 'utf8');
    } else {
      try { fs.unlinkSync(desktopFile); } catch {}
    }
  }
  return { ok: true };
});
