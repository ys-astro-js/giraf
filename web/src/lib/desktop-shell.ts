// The desktop app (Electron) draws the window controls inside the toolbar:
// traffic lights on the left on macOS, the controls overlay on the right on
// Windows and Linux (desktop/main.cjs, styles/workbench/toolbar.css).

type DesktopShell = {
  setTitleBarColors: (color: string, symbolColor: string) => void
}

declare global {
  interface Window {
    girafShell?: DesktopShell
  }
}

export function installDesktopShell(root: HTMLElement) {
  if (!navigator.userAgent.includes("Electron")) return
  root.dataset.shell = "desktop"
  const shell = window.girafShell
  if (!shell) return
  root.dataset.windowControls = "overlay"
  // Electron only parses sRGB colors; the theme is in oklch.
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!context) return
  const rgb = (variable: string) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = getComputedStyle(root).getPropertyValue(variable).trim()
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  }
  const sync = () => shell.setTitleBarColors(rgb("--background"), rgb("--foreground"))
  // The theme provider switches the light/dark class on the root.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["class"] })
  sync()
}
