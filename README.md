# Multi Script Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight Electron desktop app for managing a collection of shell scripts across multiple projects. Point it at a parent folder, and it discovers, launches, monitors, and stops your scripts from a single dashboard.

![Dashboard screenshot](docs/screenshot-dashboard.png)

---

## Features

- **Auto-discovery** — scans child folders for scripts matching configurable glob patterns (`start*.sh`, `run*.sh`, etc.)
- **Process control** — Start, Stop (SIGTERM → SIGKILL after 5 s), or force-Kill any script
- **Process group kill** — kills the entire process tree, not just the parent shell
- **Live log tail** — inline, scrollable log per script, streamed in real time
- **Auto-restore** — remembers which scripts were running and offers to restore them on next launch
- **Glob patterns** — configure which filenames are treated as launchable scripts (e.g. `start*.sh`, `dev*.sh`)
- **Excluded folders** — hide specific folders from the dashboard (including the app itself)
- **Cross-platform** — `.sh` on Linux/macOS, `.bat`/`.ps1` on Windows
- **No framework** — vanilla JS renderer, no bundler, no React

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later
- npm
- Linux/macOS: a running display server (X11 or Wayland)
- Windows: works out of the box

---

## Quick start

```bash
git clone https://github.com/mrdatawolf/MultiScriptManager.git
cd MultiScriptManager
npm install
./start.sh          # Linux/macOS
npm start           # Windows (or any platform)
```

`start.sh` runs pre-flight checks (Node version, Electron binary, display server) before launching. Use it on Linux/macOS to catch common issues early.

---

## Usage

1. **Open Settings** and set your **Parent folder** — the directory that contains your project sub-folders.
2. Return to the **Dashboard**. Each sub-folder that contains matching scripts appears as a card.
3. Click a folder card to expand it, then hit **Start** on any script.
4. Use **Stop** for a graceful shutdown or **Kill** to force-terminate the entire process tree immediately.
5. Click **Log** to open an inline log tail for that script.

### Restore on launch

If scripts were running when you closed the app, a banner appears on next open offering to restore them all with one click.

---

## Settings

| Setting | Description |
|---|---|
| **Parent folder** | Root directory scanned for project sub-folders |
| **Script patterns — Unix** | Glob patterns for launchable scripts on Linux/macOS (default: `start*.sh, run*.sh, dev*.sh, server*.sh`) |
| **Script patterns — Windows** | Glob patterns for launchable scripts on Windows (default: `start*.bat, start*.ps1, run*.bat, run*.ps1`) |
| **Excluded folders** | Folder names to hide from the dashboard (comma-separated) |
| **Log tail lines** | Number of lines kept in memory per script (10–500) |
| **Restore on launch** | Offer to restart previously-running scripts on app open |

Settings are saved to your OS user-config directory via [electron-store](https://github.com/sindresorhus/electron-store):

| OS | Location |
|---|---|
| Linux | `~/.config/multi-script-manager/` |
| macOS | `~/Library/Application Support/multi-script-manager/` |
| Windows | `%APPDATA%\multi-script-manager\` |

Use **Settings → Danger zone → Clear all data** to reset everything to defaults.

---

## Building a Windows installer

```bash
npm run dist
```

This uses `electron-builder` to produce a self-contained Squirrel.Windows installer at
`dist/squirrel-windows/Multi Script Manager-Setup-<version>.exe`. The Setup.exe embeds the
full application package, so it installs without needing any further downloads.

A copy of the latest installer is kept in [`Distribute/`](Distribute/) for handing out to users.

---

## Project structure

```
MultiScriptManager/
├── main.js          # Electron main process — IPC handlers, process management
├── preload.js       # Context bridge — exposes safe API to renderer
├── renderer/
│   ├── index.html
│   ├── app.js       # UI logic (vanilla JS)
│   └── styles.css
├── start.sh         # Launch helper with pre-flight checks (Linux/macOS)
└── package.json
```

---

## Troubleshooting

**App won't start on Linux**
Run `./start.sh` instead of `npm start` — it checks for common issues like a missing display server or the `ELECTRON_RUN_AS_NODE` environment variable being set (which breaks Electron launch).

**Scripts not appearing in the dashboard**
Check that your script filenames match the configured glob patterns in Settings. The default patterns are `start*.sh`, `run*.sh`, `dev*.sh`, `server*.sh`.

**Stop / Kill has no effect**
The app kills the entire process group. If a script spawns children that ignore signals, use **Kill** (SIGKILL) which cannot be caught or ignored.

---

## License

MIT
