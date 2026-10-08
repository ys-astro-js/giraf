// GIRAF desktop shell: starts the bundled Python backend and shows it in a window.
const { app, BrowserWindow, dialog, shell } = require("electron")
const { spawn, execFileSync } = require("node:child_process")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")

// Runs and app state live here (GIRAF_DATA); the bundle itself is read-only.
const DATA = process.env.GIRAF_DATA || path.join(os.homedir(), "Documents", "GIRAF")

let backend = null
let quitting = false

const pythonIn = (home) =>
  process.platform === "win32" ? path.join(home, "python.exe") : path.join(home, "bin", "python3")

function backendPaths() {
  if (app.isPackaged) {
    const resources = process.resourcesPath
    return {
      python: pythonIn(path.join(resources, "python")),
      root: path.join(resources, "backend"),
    }
  }
  // Development: the repository's own uv environment.
  const root = path.resolve(__dirname, "..")
  const venv = path.join(root, ".venv")
  return { python: process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : pythonIn(venv), root }
}

/**
 * Apps opened from Finder get a minimal environment. IRAF (`iraf`, PATH to
 * irafcl) is usually configured in the login shell, so take it from there.
 */
function loginShellEnv() {
  if (process.platform === "win32") return {}
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

async function waitForServer(url, child) {
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`백엔드가 종료되었습니다 (코드 ${child.exitCode}).`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("백엔드가 30초 안에 응답하지 않았습니다.")
}

async function startBackend() {
  const { python, root } = backendPaths()
  const port = await freePort()
  fs.mkdirSync(DATA, { recursive: true })
  const log = fs.openSync(path.join(DATA, "giraf.log"), "a")
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
  backend = spawn(python, [path.join(root, "main.py")], {
    cwd: root,
    env,
    stdio: ["ignore", log, log],
  })
  backend.on("exit", (code) => {
    if (!quitting) {
      dialog.showErrorBox("GIRAF", `백엔드가 종료되었습니다 (코드 ${code}).\n로그: ${path.join(DATA, "giraf.log")}`)
      app.quit()
    }
  })
  const url = `http://127.0.0.1:${port}/`
  await waitForServer(url, backend)
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

app.whenReady().then(async () => {
  try {
    const url = await startBackend()
    createWindow(url)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url)
    })
  } catch (error) {
    quitting = true
    dialog.showErrorBox("GIRAF", `${error.message}\n로그: ${path.join(DATA, "giraf.log")}`)
    backend?.kill()
    app.quit()
  }
})

app.on("window-all-closed", () => app.quit())

app.on("before-quit", () => {
  quitting = true
  backend?.kill("SIGTERM")
})
