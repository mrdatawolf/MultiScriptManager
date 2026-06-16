// ── State ────────────────────────────────────────────────────────────────────

const state = {
  page: 'dashboard',
  settings: {},
  folders: [],       // [{ folderName, folderPath, scripts: [...] }]
  openFolders: new Set(),
  openLogs: new Set(),
  filter: '',
  restoreKeys: [],   // keys that were running before last close
  hiddenScripts: new Set(),
  showHidden: false,
  folderMeta: {},    // { [folderName]: { shortName, uri } }
  editingFolder: null, // folderName currently showing the inline edit form
};

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  state.settings = await window.api.getSettings();
  state.restoreKeys = await window.api.getLastRunning();
  state.hiddenScripts = new Set(state.settings.hiddenScripts ?? []);
  state.folderMeta = await window.api.getFolderMeta();

  // Wire live events
  window.api.onOutput(({ key, lines }) => {
    appendOutput(key, lines);
  });

  window.api.onStopped(({ key, code, status }) => {
    updateScriptStatus(key, status ?? (code === 0 ? 'stopped' : 'crashed'), code);
  });

  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });

  await navigate('dashboard');
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  if (page === 'dashboard') renderDashboard();
  else renderSettings();
}

// ── Dashboard ────────────────────────────────────────────────────────────────

async function renderDashboard() {
  const app = document.getElementById('app');

  if (!state.settings.parentFolder) {
    app.innerHTML = `
      <div class="empty-state">
        <p>No parent folder configured.</p>
        <button class="btn btn-primary" id="go-settings">Open Settings</button>
      </div>`;
    document.getElementById('go-settings').onclick = () => navigate('settings');
    return;
  }

  state.folders = await window.api.scanScripts();

  let html = '';

  // Restore banner
  const restoreable = state.restoreKeys.filter(k =>
    state.folders.some(f => f.scripts.some(s => s.key === k))
  );
  if (restoreable.length > 0) {
    html += `
      <div class="restore-banner" id="restore-banner">
        <span>${restoreable.length} script(s) were running before last close.</span>
        <button class="btn btn-warn btn-sm" id="restore-btn">Restore All</button>
        <button class="btn btn-ghost btn-sm" id="restore-dismiss">Dismiss</button>
      </div>`;
  }

  const hiddenCount = state.hiddenScripts.size;
  html += `
    <div class="dashboard-header">
      <h2>Scripts</h2>
      <div class="dashboard-header-actions">
        <button class="btn btn-ghost" id="toggle-hidden"${hiddenCount === 0 ? ' style="display:none"' : ''}>${state.showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}</button>
        <button class="btn btn-ghost" id="refresh-btn">↻ Refresh</button>
      </div>
    </div>
    <input class="search-bar" id="search" placeholder="Filter folders or scripts…" value="${escHtml(state.filter)}" />`;

  if (state.folders.length === 0) {
    html += `<div class="empty-state"><p>No scripts found in <code>${escHtml(state.settings.parentFolder)}</code></p></div>`;
  } else {
    html += renderFolderCards();
  }

  app.innerHTML = html;

  // Bind events
  document.getElementById('refresh-btn')?.addEventListener('click', renderDashboard);
  document.getElementById('search')?.addEventListener('input', e => {
    state.filter = e.target.value;
    document.getElementById('folders-list').innerHTML = renderFolderCards(true);
    bindFolderEvents();
  });
  document.getElementById('toggle-hidden')?.addEventListener('click', () => {
    state.showHidden = !state.showHidden;
    updateHiddenToggleBtn();
    document.getElementById('folders-list').innerHTML = renderFolderCards(true);
    bindFolderEvents();
  });

  document.getElementById('restore-btn')?.addEventListener('click', () => {
    restoreable.forEach(key => {
      const info = findScript(key);
      if (info) doStart(info);
    });
    state.restoreKeys = [];
    document.getElementById('restore-banner')?.remove();
  });

  document.getElementById('restore-dismiss')?.addEventListener('click', () => {
    state.restoreKeys = [];
    document.getElementById('restore-banner')?.remove();
  });

  bindFolderEvents();
}

function renderFolderHeader(folder, runningCount) {
  const { folderName } = folder;
  const meta = state.folderMeta[folderName] ?? {};
  const badge = `<span class="folder-badge ${runningCount > 0 ? 'badge-running' : 'badge-stopped'}">
    ${runningCount > 0 ? `${runningCount} running` : `${folder.scripts.length} scripts`}
  </span>`;

  if (state.editingFolder === folderName) {
    return `
      <div class="folder-header folder-header-editing" data-folder="${escHtml(folderName)}">
        <span class="folder-chevron">▶</span>
        <input class="folder-meta-input" id="edit-shortname-${cssId(folderName)}"
          type="text" placeholder="Short name" maxlength="8"
          value="${escHtml(meta.shortName ?? '')}" />
        <input class="folder-meta-input folder-meta-uri" id="edit-uri-${cssId(folderName)}"
          type="text" placeholder="URI (e.g. http://localhost:3000)"
          value="${escHtml(meta.uri ?? '')}" />
        <button class="btn btn-primary btn-sm folder-meta-save" data-folder="${escHtml(folderName)}">Save</button>
        <button class="btn btn-ghost btn-sm folder-meta-cancel" data-folder="${escHtml(folderName)}">Cancel</button>
        ${badge}
      </div>`;
  }

  const shortNameHtml = meta.shortName
    ? `<span class="folder-short-name">${escHtml(meta.shortName)}</span>`
    : '';
  const openHtml = meta.uri
    ? `<button class="btn btn-ghost btn-sm folder-open-btn" data-folder="${escHtml(folderName)}" data-uri="${escHtml(meta.uri)}">Open</button>`
    : '';

  return `
    <div class="folder-header" data-folder="${escHtml(folderName)}">
      <span class="folder-chevron">▶</span>
      <span class="folder-name">${escHtml(folderName)}</span>
      ${shortNameHtml}
      ${openHtml}
      <button class="btn btn-ghost btn-sm folder-edit-btn" data-folder="${escHtml(folderName)}">✎</button>
      ${badge}
    </div>`;
}

function renderFolderCards(innerOnly = false) {
  const q = state.filter.toLowerCase();
  const filtered = state.folders.map(folder => {
    let scripts = state.showHidden
      ? folder.scripts
      : folder.scripts.filter(s => !state.hiddenScripts.has(s.key));
    if (q) {
      const nameMatch = folder.folderName.toLowerCase().includes(q);
      scripts = nameMatch ? scripts : scripts.filter(s =>
        s.scriptFile.toLowerCase().includes(q)
      );
    }
    return { ...folder, scripts };
  }).filter(f => f.scripts.length > 0);

  let html = `<div id="folders-list">`;

  for (const folder of filtered) {
    const runningCount = folder.scripts.filter(s => s.status === 'running').length;
    const isOpen = state.openFolders.has(folder.folderName);

    html += `
      <div class="folder-card ${isOpen ? 'open' : ''}" data-folder="${escHtml(folder.folderName)}">
        ${renderFolderHeader(folder, runningCount)}
        <div class="script-list">
          ${folder.scripts.map(s => renderScriptRow(s)).join('')}
        </div>
      </div>`;
  }

  html += `</div>`;
  return innerOnly ? html.replace('<div id="folders-list">', '').replace(/(<\/div>)\s*$/, '') : html;
}

function renderScriptRow(s) {
  const isHidden = state.hiddenScripts.has(s.key);
  const statusClass = s.status === 'running' ? 'status-running'
    : s.status === 'crashed' ? 'status-crashed' : 'status-stopped';
  const logOpen = state.openLogs.has(s.key);

  return `
    <div class="script-row${isHidden ? ' script-row-hidden' : ''}" data-key="${escHtml(s.key)}">
      <div class="script-controls">
        <span class="status-dot ${statusClass}"></span>
        <span class="script-name">${escHtml(s.scriptFile)}</span>
        <div class="script-actions">
          ${s.status === 'running'
            ? `<button class="btn btn-warn btn-sm stop-btn" data-key="${escHtml(s.key)}">Stop</button>
               <button class="btn btn-danger btn-sm kill-btn" data-key="${escHtml(s.key)}">Kill</button>`
            : `<button class="btn btn-primary btn-sm start-btn" data-key="${escHtml(s.key)}">Start</button>`
          }
          <button class="log-toggle" data-key="${escHtml(s.key)}">${logOpen ? 'Hide log' : 'Log'}</button>
          <button class="hide-btn" data-key="${escHtml(s.key)}">${isHidden ? 'Unhide' : 'Hide'}</button>
        </div>
      </div>
      <div class="log-pane ${logOpen ? 'open' : ''}" id="log-${cssId(s.key)}">
        ${(s.output || []).map(l => `<div class="log-line">${escHtml(l)}</div>`).join('')}
      </div>
    </div>`;
}

function bindFolderEvents() {
  document.querySelectorAll('.folder-header').forEach(header => {
    // Expand/collapse on chevron or folder name only
    header.addEventListener('click', (e) => {
      if (e.target.closest('.folder-edit-btn, .folder-open-btn, .folder-meta-save, .folder-meta-cancel, .folder-meta-input')) return;
      const card = header.closest('.folder-card');
      const name = card.dataset.folder;
      if (state.openFolders.has(name)) state.openFolders.delete(name);
      else state.openFolders.add(name);
      card.classList.toggle('open');
    });

    // Edit button — show inline form
    header.querySelector('.folder-edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const folderName = e.currentTarget.dataset.folder;
      state.editingFolder = folderName;
      refreshFolderHeader(folderName);
    });

    // Open button — launch URI in browser
    header.querySelector('.folder-open-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openExternal(e.currentTarget.dataset.uri);
    });

    // Save button
    header.querySelector('.folder-meta-save')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderName = e.currentTarget.dataset.folder;
      const shortName = document.getElementById(`edit-shortname-${cssId(folderName)}`)?.value.trim().slice(0, 8) ?? '';
      const uri = document.getElementById(`edit-uri-${cssId(folderName)}`)?.value.trim() ?? '';
      state.folderMeta = await window.api.setFolderMeta(folderName, { shortName, uri });
      state.editingFolder = null;
      refreshFolderHeader(folderName);
    });

    // Cancel button
    header.querySelector('.folder-meta-cancel')?.addEventListener('click', (e) => {
      e.stopPropagation();
      state.editingFolder = null;
      refreshFolderHeader(e.currentTarget.dataset.folder);
    });
  });

  // Bind all script rows on initial render
  document.querySelectorAll('.script-row').forEach(row => bindRowActions(row));
}

function refreshFolderHeader(folderName) {
  const card = document.querySelector(`.folder-card[data-folder="${CSS.escape(folderName)}"]`);
  if (!card) return;
  const folder = state.folders.find(f => f.folderName === folderName);
  if (!folder) return;
  const runningCount = folder.scripts.filter(s => s.status === 'running').length;
  const oldHeader = card.querySelector('.folder-header');
  const newHeader = document.createElement('div');
  newHeader.innerHTML = renderFolderHeader(folder, runningCount);
  const headerEl = newHeader.firstElementChild;
  card.replaceChild(headerEl, oldHeader);
  // Re-bind events for just this header
  const allHeaders = document.querySelectorAll('.folder-header');
  allHeaders.forEach(h => {
    if (h.closest('.folder-card')?.dataset.folder === folderName) {
      bindSingleFolderHeader(h);
    }
  });
}

function bindSingleFolderHeader(header) {
  header.addEventListener('click', (e) => {
    if (e.target.closest('.folder-edit-btn, .folder-open-btn, .folder-meta-save, .folder-meta-cancel, .folder-meta-input')) return;
    const card = header.closest('.folder-card');
    const name = card.dataset.folder;
    if (state.openFolders.has(name)) state.openFolders.delete(name);
    else state.openFolders.add(name);
    card.classList.toggle('open');
  });

  header.querySelector('.folder-edit-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.editingFolder = e.currentTarget.dataset.folder;
    refreshFolderHeader(e.currentTarget.dataset.folder);
  });

  header.querySelector('.folder-open-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.openExternal(e.currentTarget.dataset.uri);
  });

  header.querySelector('.folder-meta-save')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const folderName = e.currentTarget.dataset.folder;
    const shortName = document.getElementById(`edit-shortname-${cssId(folderName)}`)?.value.trim().slice(0, 8) ?? '';
    const uri = document.getElementById(`edit-uri-${cssId(folderName)}`)?.value.trim() ?? '';
    state.folderMeta = await window.api.setFolderMeta(folderName, { shortName, uri });
    state.editingFolder = null;
    refreshFolderHeader(folderName);
  });

  header.querySelector('.folder-meta-cancel')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.editingFolder = null;
    refreshFolderHeader(e.currentTarget.dataset.folder);
  });
}

// Bind only the action buttons inside a single script row.
// Called after innerHTML swap so old listeners are already gone.
function bindRowActions(row) {
  const startBtn = row.querySelector('.start-btn');
  const stopBtn  = row.querySelector('.stop-btn');
  const killBtn  = row.querySelector('.kill-btn');
  const logBtn   = row.querySelector('.log-toggle');
  const hideBtn  = row.querySelector('.hide-btn');

  startBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    const info = findScript(startBtn.dataset.key);
    if (info) await doStart(info);
  });

  stopBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    await window.api.stopProcess({ key: stopBtn.dataset.key, force: false });
  });

  killBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    await window.api.stopProcess({ key: killBtn.dataset.key, force: true });
  });

  logBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    const key = logBtn.dataset.key;
    if (state.openLogs.has(key)) {
      state.openLogs.delete(key);
      logBtn.textContent = 'Log';
      document.getElementById(`log-${cssId(key)}`)?.classList.remove('open');
    } else {
      state.openLogs.add(key);
      logBtn.textContent = 'Hide log';
      const pane = document.getElementById(`log-${cssId(key)}`);
      if (pane) {
        pane.classList.add('open');
        const lines = await window.api.getOutput({ key });
        pane.innerHTML = lines.map(l => `<div class="log-line">${escHtml(l)}</div>`).join('');
        pane.scrollTop = pane.scrollHeight;
      }
    }
  });

  hideBtn?.addEventListener('click', async e => {
    e.stopPropagation();
    const key = hideBtn.dataset.key;
    if (state.hiddenScripts.has(key)) {
      state.hiddenScripts.delete(key);
    } else {
      state.hiddenScripts.add(key);
    }
    await window.api.setSettings({ hiddenScripts: [...state.hiddenScripts] });
    updateHiddenToggleBtn();
    document.getElementById('folders-list').innerHTML = renderFolderCards(true);
    bindFolderEvents();
  });
}

async function doStart(scriptInfo) {
  const { key, folderPath, scriptFile } = scriptInfo;
  const result = await window.api.startProcess({ key, folderPath, scriptFile });
  if (!result.ok) {
    showToast(`Could not start: ${result.reason}`);
    return;
  }
  updateScriptStatus(key, 'running', null);
}

function updateScriptStatus(key, status, exitCode) {
  // Update in state
  for (const folder of state.folders) {
    const script = folder.scripts.find(s => s.key === key);
    if (script) {
      script.status = status;
      script.exitCode = exitCode;
    }
  }

  // Update DOM without full re-render
  const row = document.querySelector(`.script-row[data-key="${CSS.escape(key)}"]`);
  if (!row) return;

  const dot = row.querySelector('.status-dot');
  const actions = row.querySelector('.script-actions');
  const logToggle = row.querySelector('.log-toggle');

  dot?.classList.remove('status-running', 'status-stopped', 'status-crashed');
  if (status === 'running') dot?.classList.add('status-running');
  else if (status === 'crashed') dot?.classList.add('status-crashed');
  else dot?.classList.add('status-stopped');

  if (actions) {
    const isHidden = state.hiddenScripts.has(key);
    const logHtml = logToggle ? logToggle.outerHTML : `<button class="log-toggle" data-key="${escHtml(key)}">Log</button>`;
    const hideHtml = `<button class="hide-btn" data-key="${escHtml(key)}">${isHidden ? 'Unhide' : 'Hide'}</button>`;
    if (status === 'running') {
      actions.innerHTML = `
        <button class="btn btn-warn btn-sm stop-btn" data-key="${escHtml(key)}">Stop</button>
        <button class="btn btn-danger btn-sm kill-btn" data-key="${escHtml(key)}">Kill</button>
        ${logHtml}
        ${hideHtml}`;
    } else {
      actions.innerHTML = `
        <button class="btn btn-primary btn-sm start-btn" data-key="${escHtml(key)}">Start</button>
        ${logHtml}
        ${hideHtml}`;
    }
    bindRowActions(row);
  }

  // Update folder badge
  const folderCard = row.closest('.folder-card');
  if (folderCard) {
    const folderName = folderCard.dataset.folder;
    const folder = state.folders.find(f => f.folderName === folderName);
    if (folder) {
      const runningCount = folder.scripts.filter(s => s.status === 'running').length;
      const badge = folderCard.querySelector('.folder-badge');
      if (badge) {
        badge.className = `folder-badge ${runningCount > 0 ? 'badge-running' : 'badge-stopped'}`;
        badge.textContent = runningCount > 0 ? `${runningCount} running` : `${folder.scripts.length} scripts`;
      }
    }
  }

}

function appendOutput(key, lines) {
  const pane = document.getElementById(`log-${cssId(key)}`);
  if (!pane || !pane.classList.contains('open')) return;

  const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  lines.forEach(line => {
    const div = document.createElement('div');
    div.className = 'log-line';
    div.textContent = line;
    pane.appendChild(div);
  });

  // Trim displayed lines to 300
  while (pane.children.length > 300) pane.removeChild(pane.firstChild);

  if (atBottom) pane.scrollTop = pane.scrollHeight;
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function renderSettings() {
  const s = state.settings;
  const [{ enabled: loginEnabled }, appVersion] = await Promise.all([
    window.api.getLoginItem(),
    window.api.getVersion(),
  ]);
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="settings-page">
      <h2>Settings</h2>

      <div class="settings-section">
        <h3>Folders</h3>
        <div class="form-row">
          <label>Parent folder</label>
          <span class="folder-display" id="folder-display">${escHtml(s.parentFolder || 'Not set')}</span>
          <button class="btn btn-ghost" id="pick-folder">Browse…</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Script patterns — Unix / Linux / macOS</h3>
        <div class="form-row">
          <label>Filenames (comma-separated)</label>
          <input type="text" id="unix-patterns" value="${escHtml((s.unixPatterns || ['start*.sh','run*.sh','dev*.sh','server*.sh']).join(', '))}" />
        </div>
      </div>

      <div class="settings-section">
        <h3>Script patterns — Windows</h3>
        <div class="form-row">
          <label>Filenames (comma-separated)</label>
          <input type="text" id="win-patterns" value="${escHtml((s.windowsPatterns || ['start*.bat','start*.ps1','run*.bat','run*.ps1']).join(', '))}" />
        </div>
      </div>

      <div class="settings-section">
        <h3>Excluded folders</h3>
        <div class="form-row">
          <label>Skip these folders (comma-separated names)</label>
          <input type="text" id="excluded-folders" value="${escHtml((s.excludedFolders || []).join(', '))}" placeholder="e.g. MultiScriptManager, .hidden" />
        </div>
      </div>

      <div class="settings-section">
        <h3>Behaviour</h3>
        <div class="form-row">
          <label>Log tail lines</label>
          <input type="number" id="log-tail" value="${s.logTailLines ?? 50}" min="10" max="500" style="width:80px;flex:none" />
        </div>
        <div class="form-row">
          <label>Restore on launch</label>
          <label class="toggle-switch">
            <input type="checkbox" id="restore-on-launch" ${s.restoreOnLaunch !== false ? 'checked' : ''} />
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="form-row">
          <label>Start on login</label>
          <label class="toggle-switch">
            <input type="checkbox" id="start-on-login" ${loginEnabled ? 'checked' : ''} />
            <span class="toggle-track"></span>
          </label>
        </div>
      </div>

      <div class="settings-footer">
        <button class="btn btn-primary" id="save-settings">Save</button>
      </div>

      <div class="settings-section" style="border-color: rgba(233,69,96,0.3)">
        <h3 style="color: var(--accent)">Danger zone</h3>
        <div class="form-row">
          <label style="flex:1">Reset all settings to defaults</label>
          <button class="btn btn-danger" id="clear-settings">Clear all data</button>
        </div>
      </div>

      <div class="settings-version">v${escHtml(appVersion)}</div>
    </div>`;

  document.getElementById('pick-folder').addEventListener('click', async () => {
    const folder = await window.api.pickFolder();
    if (folder) {
      document.getElementById('folder-display').textContent = folder;
      document.getElementById('folder-display').dataset.value = folder;
    }
  });

  document.getElementById('start-on-login').addEventListener('change', async (e) => {
    await window.api.setLoginItem({ enabled: e.target.checked });
    showToast(e.target.checked ? 'Start on login enabled' : 'Start on login disabled');
  });

  document.getElementById('clear-settings').addEventListener('click', async () => {
    if (!confirm('Clear all saved settings? The app will return to defaults.')) return;
    state.settings = await window.api.clearSettings();
    showToast('Settings cleared — reloading…');
    setTimeout(() => navigate('settings'), 800);
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const folderDisplay = document.getElementById('folder-display');
    const parentFolder = folderDisplay.dataset.value || state.settings.parentFolder || '';

    const parsePatterns = id => document.getElementById(id).value
      .split(',').map(v => v.trim()).filter(Boolean);

    const updates = {
      parentFolder,
      unixPatterns: parsePatterns('unix-patterns'),
      windowsPatterns: parsePatterns('win-patterns'),
      excludedFolders: parsePatterns('excluded-folders'),
      logTailLines: parseInt(document.getElementById('log-tail').value, 10) || 50,
      restoreOnLaunch: document.getElementById('restore-on-launch').checked,
    };

    state.settings = await window.api.setSettings(updates);
    showToast('Settings saved');
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findScript(key) {
  for (const folder of state.folders) {
    const s = folder.scripts.find(sc => sc.key === key);
    if (s) return s;
  }
  return null;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Make a key safe to use as a CSS id selector
function cssId(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function updateHiddenToggleBtn() {
  const btn = document.getElementById('toggle-hidden');
  if (!btn) return;
  const hiddenCount = state.hiddenScripts.size;
  btn.style.display = hiddenCount > 0 ? '' : 'none';
  btn.textContent = state.showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Start ─────────────────────────────────────────────────────────────────────
boot();
