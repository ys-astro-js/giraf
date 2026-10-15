// Bridge for the web page: the app update (see main.cjs) everywhere, and on
// Windows and Linux, where the window controls overlay the toolbar, the
// page's theme colors so they match.
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("girafShell", {
  update: {
    get: () => ipcRenderer.invoke("update-get"),
    check: () => ipcRenderer.invoke("update-check"),
    install: () => ipcRenderer.send("update-install"),
    onState: (callback) => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on("update-state", listener)
      return () => ipcRenderer.removeListener("update-state", listener)
    },
  },
  ...(process.platform !== "darwin" && {
    setTitleBarColors: (color, symbolColor) =>
      ipcRenderer.send("title-bar-colors", color, symbolColor),
  }),
})
