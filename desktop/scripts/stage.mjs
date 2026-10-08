// Stage the Python runtime, dependencies, backend and web build for the app.
// Output: desktop/build/{python,backend}. Does not touch web/dist.
// Runs on macOS and Linux: node scripts/stage.mjs. The Windows app ships the
// Linux stage and runs it in WSL (bun run wsl-archive).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPO = path.resolve(DESKTOP, "..")
const BUILD = path.join(DESKTOP, "build")
const PYTHON_VERSION = fs.readFileSync(path.join(REPO, ".python-version"), "utf8").trim()

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", cwd: REPO, ...options })
const output = (command, args) =>
  execFileSync(command, args, { cwd: REPO, encoding: "utf8" }).trim()

fs.rmSync(BUILD, { recursive: true, force: true })
fs.mkdirSync(path.join(BUILD, "backend"), { recursive: true })

// 1. Relocatable CPython (python-build-standalone, managed by uv).
run("uv", ["python", "install", PYTHON_VERSION])
const found = fs.realpathSync(output("uv", ["python", "find", "--managed-python", PYTHON_VERSION]))
const home = path.dirname(path.dirname(found))
const python = path.join(BUILD, "python")
fs.cpSync(home, python, { recursive: true, verbatimSymlinks: true })
const stdlib = path.join(python, "lib", `python${PYTHON_VERSION}`)
fs.rmSync(path.join(stdlib, "EXTERNALLY-MANAGED"), { force: true })
const interpreter = path.join(python, "bin", "python3")

// 2. Locked dependencies into that interpreter's site-packages.
const requirements = path.join(BUILD, "requirements.txt")
run("uv", ["export", "--frozen", "--no-dev", "--no-hashes", "--no-emit-project", "-o", requirements], {
  stdio: ["ignore", "ignore", "inherit"],
})
run("uv", ["pip", "install", "--python", interpreter, "--system", "--break-system-packages",
  "--no-cache", "--compile-bytecode", "-r", requirements])

// 3. Backend source.
fs.cpSync(path.join(REPO, "giraf"), path.join(BUILD, "backend", "giraf"), {
  recursive: true,
  filter: (source) => !source.includes("__pycache__") && !source.endsWith(".pyc"),
})
fs.copyFileSync(path.join(REPO, "main.py"), path.join(BUILD, "backend", "main.py"))

// 4. Web build into the backend's static folder.
const web = path.join(REPO, "web")
run("bun", ["install", "--frozen-lockfile"], { cwd: web })
run("bunx", ["vite", "build", "--outDir", path.join(BUILD, "backend", "web", "dist"), "--emptyOutDir"], { cwd: web })

// Trim what the app never uses.
for (const unused of [requirements, path.join(python, "include"), path.join(python, "share"),
  path.join(stdlib, "test"), path.join(stdlib, "idlelib", "idle_test")])
  fs.rmSync(unused, { recursive: true, force: true })
// Static libraries only serve building extensions, and notarization rejects them.
for (const file of fs.readdirSync(python, { recursive: true }))
  if (file.endsWith(".a")) fs.rmSync(path.join(python, file))
console.log(`Staged backend in ${BUILD}`)
