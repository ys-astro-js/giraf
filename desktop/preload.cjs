// Bridge for the web page. On Windows and Linux the window controls overlay the
// toolbar; the page sends its theme colors so they match (see main.cjs).
const { contextBridge, ipcRenderer } = require("electron")

if (process.platform !== "darwin") {
  contextBridge.exposeInMainWorld("girafShell", {
    setTitleBarColors: (color, symbolColor) =>
      ipcRenderer.send("title-bar-colors", color, symbolColor),
  })
}
