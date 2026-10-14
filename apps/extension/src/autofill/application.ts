/**
 * Application identity is browser-independent, so it lives with the rest of
 * the shared rules in `resume-core/dom-agent`; ADR 0001 covers the identity
 * rule itself. This path exists only because the retired engine still imports
 * it, and it is deleted in the final sweep along with that engine.
 */
export {
  applicationIdentity,
  originOf,
  sameApplication,
} from "@workspace/resume-core/dom-agent"
