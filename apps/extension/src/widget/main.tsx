import { createRoot } from "react-dom/client"
import { Widget } from "./Widget"
import "./styles.css"

const root = document.getElementById("root")
if (root) createRoot(root).render(<Widget />)
