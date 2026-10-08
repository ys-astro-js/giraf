// GIRAF desktop shell: starts the bundled Python backend and shows it in a window.
const { app, BrowserWindow, dialog, shell } = require("electron")
const { spawn, execFileSync } = require("node:child_process")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")

const WINDOWS = process.platform === "win32"

// Runs and app state live here (GIRAF_DATA); the bundle itself is read-only.
// On Windows the backend runs in WSL; start.sh puts them in the same Windows
// folder, seen from WSL as /mnt/c/Users/<name>/Documents/GIRAF.
const DATA = process.env.GIRAF_DATA || path.join(os.homedir(), "Documents", "GIRAF")
const LOG = WINDOWS ? path.join(app.getPath("userData"), "giraf.log") : path.join(DATA, "giraf.log")

let backend = null
let stopBackend = () => backend?.kill("SIGTERM")
let quitting = false

function backendPaths() {
  if (app.isPackaged) {
    const resources = process.resourcesPath
    return { python: path.join(resources, "python", "bin", "python3"), root: path.join(resources, "backend") }
  }
  // Development: the repository's own uv environment.
  const root = path.resolve(__dirname, "..")
  return { python: path.join(root, ".venv", "bin", "python3"), root }
}

/**
 * Apps opened from Finder get a minimal environment. IRAF (`iraf`, PATH to
 * irafcl) is usually configured in the login shell, so take it from there.
 */
function loginShellEnv() {
  const marker = "__GIRAF_ENV__"
  try {
    const shellPath = process.env.SHELL || "/bin/zsh"
    const out = execFileSync(shellPath, ["-ilc", `printf '${marker}'; env -0; printf '${marker}'`], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const body = out.split(marker)[1] || ""
    return Object.fromEntries(
      body
        .split("\0")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    )
  } catch {
    return {}
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForServer(url, child, seconds) {
  for (let i = 0; i < seconds * 10; i++) {
    if (child.exitCode !== null) throw new Error(`백엔드가 종료되었습니다 (코드 ${child.exitCode}).`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`백엔드가 ${seconds}초 안에 응답하지 않았습니다.`)
}

function launchLocal(port, log) {
  const { python, root } = backendPaths()
  fs.mkdirSync(DATA, { recursive: true })
  const env = {
    ...process.env,
    ...loginShellEnv(),
    GIRAF_DATA: DATA,
    GIRAF_PORT: String(port),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
  }
  delete env.PYTHONHOME
  delete env.PYTHONPATH
  delete env.VIRTUAL_ENV
  return spawn(python, [path.join(root, "main.py")], { cwd: root, env, stdio: ["ignore", log, log] })
}

const wsl = (args, options = {}) =>
  execFileSync("wsl.exe", ["-e", ...args], { encoding: "utf8", windowsHide: true, ...options }).trim()

/**
 * Windows: IRAF lives in WSL, so the bundled Linux backend runs there. It is
 * unpacked into the WSL home once per app build, then started by start.sh.
 */
function launchWsl(port, log) {
  const archive = path.join(process.resourcesPath, "wsl", "giraf-linux.tar.gz")
  const stamp = `${app.getVersion()}-${fs.statSync(archive).size}`
  let runtime
  try {
    runtime = wsl(
      [
        "sh",
        "-c",
        'd="$HOME/.giraf/runtime"; a=$(wslpath -a "$1"); ' +
          '[ "$(cat "$d/.stamp" 2>/dev/null)" = "$2" ] || ' +
          '{ rm -rf "$d" && mkdir -p "$d" && tar -xzf "$a" -C "$d" && echo "$2" > "$d/.stamp"; } && echo "$d"',
        "sh",
        archive,
        stamp,
      ],
      { timeout: 300000 }
    )
  } catch (error) {
    throw new Error(`WSL에 GIRAF 백엔드를 준비하지 못했습니다. WSL과 Linux 배포판이 설치되어 있는지 확인해 주세요.\n${error.message}`)
  }
  stopBackend = () => {
    try {
      wsl(["sh", "-c", 'kill "$(cat "$HOME/.giraf/backend.pid")"'], { timeout: 10000 })
    } catch {}
    backend?.kill()
  }
  return spawn("wsl.exe", ["-e", "sh", `${runtime}/start.sh`, String(port), os.homedir()], {
    stdio: ["ignore", log, log],
    windowsHide: true,
  })
}

async function startBackend() {
  const port = await freePort()
  fs.mkdirSync(path.dirname(LOG), { recursive: true })
  const log = fs.openSync(LOG, "a")
  backend = WINDOWS ? launchWsl(port, log) : launchLocal(port, log)
  backend.on("exit", (code) => {
    if (!quitting) {
      dialog.showErrorBox("GIRAF", `백엔드가 종료되었습니다 (코드 ${code}).\n로그: ${LOG}`)
      app.quit()
    }
  })
  const url = `http://127.0.0.1:${port}/`
  await waitForServer(url, backend, WINDOWS ? 90 : 30)
  return url
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "GIRAF",
    // The web toolbar doubles as the title bar (see web toolbar.css).
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 21, y: 22 },
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  win.once("ready-to-show", () => win.show())
  // Links leaving the local server open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault()
      shell.openExternal(target)
    }
  })
  // Traffic lights hide in full screen; the toolbar gives their room back.
  const fullscreen = (on) =>
    win.webContents.executeJavaScript(
      `document.documentElement.toggleAttribute("data-fullscreen", ${on})`
    )
  win.on("enter-full-screen", () => fullscreen(true))
  win.on("leave-full-screen", () => fullscreen(false))
  win.loadURL(url)
  return win
}

/**
 * Update in place from the latest GitHub release (desktop/package.json
 * build.publish): download in the background, install on restart or quit.
 */
function checkForUpdates() {
  if (!app.isPackaged) return
  const { autoUpdater } = require("electron-updater")
  // Offline, no release yet or an unsigned Mac build: try again next launch.
  autoUpdater.on("error", () => {})
  autoUpdater.on("update-downloaded", async ({ version }) => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["지금 재시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
      message: `GIRAF ${version}을 설치할 준비가 되었습니다.`,
      detail: "나중에를 고르면 앱을 끝낼 때 설치합니다.",
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.checkForUpdates().catch(() => {})
}

app.whenReady().then(async () => {
  try {
    const url = await startBackend()
    createWindow(url)
    checkForUpdates()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url)
    })
  } catch (error) {
    quitting = true
    dialog.showErrorBox("GIRAF", `${error.message}\n로그: ${LOG}`)
    stopBackend()
    app.quit()
  }
})

app.on("window-all-closed", () => app.quit())

app.on("before-quit", () => {
  quitting = true
  stopBackend()
})
