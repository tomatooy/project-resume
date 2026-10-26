import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { logRequest } from "./server/request-log"
export { TailorWorkflow } from "./server/tailoring/workflow"
export default createServerEntry({
  fetch: (...args) => logRequest(args[0], () => handler.fetch(...args)),
})
