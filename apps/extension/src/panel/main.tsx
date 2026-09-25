import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { App } from "./App"
import "./styles.css"
const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  )
