// A classic content script. The build bundles it alone as one IIFE, so its
// runtime imports stay inside src/autofill and @workspace/autofill/match.
import { startAutofill } from "../autofill/runtime"
import { adapterFor } from "../autofill/vendors/index"

startAutofill(adapterFor(location.hostname))
