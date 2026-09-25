import { installRuntimeDiagnostics } from "@/lib/diagnostics"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { createQueryClient } from "@/lib/queries"

import "@xyflow/react/dist/style.css"
import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

const detachDiagnostics = installRuntimeDiagnostics(window)
const queryClient = createQueryClient()
if (import.meta.hot) import.meta.hot.dispose(detachDiagnostics)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
