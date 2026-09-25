import { observeNavigation } from "./navigation"
import { registerMessages } from "./messages"
import { registerUpdates } from "./updates"
import { registerWidget } from "./widget"
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
registerMessages()
registerUpdates()
registerWidget()
observeNavigation()
