import handler from "@tanstack/react-start/server-entry"
export { TailorWorkflow } from "./server/tailoring/workflow"
export default { fetch: handler.fetch }
