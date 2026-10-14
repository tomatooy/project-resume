import {
  DOM_AGENT_LIMITS,
  attachmentIsAuthorized,
  type Action,
  type Precondition,
} from "@workspace/resume-core/dom-agent"
import type { RuntimeExpectation, RuntimeStep } from "./runtime/protocol"

/**
 * Turning a validated action into what the page is asked to do. Two of the
 * action's fields carry a convention worth stating once, because the page
 * follows it:
 *
 * - `expectedValue: null` means the control should be empty, not that the
 *   worker does not know.
 * - `expectedChecked: null` means the action does not assert the current state,
 *   which is the difference between a checkbox and a text field. The page
 *   refuses to toggle one on those terms, so only a read may carry it.
 * - `expectedOptionRef: null` means nothing should be selected, following the
 *   same convention as an empty value.
 */

/** An option as the current observation presents it, in document order. */
export type ObservedOptionRef = { ref: string; label: string }

/** Bytes that were rendered for one source bundle, with its own identity. */
export type RenderedAttachment = {
  identity: string
  name: string
  type: string
  sizeBytes: number
  base64: string
}

export type RuntimeCall = { step: RuntimeStep; expect: RuntimeExpectation }

/**
 * Null means the action cannot be expressed from the current observation: an
 * option reference the observation no longer holds, or an attachment whose
 * bytes are not the ones this action named. The caller reports unresolved
 * rather than resolving a stale reference into a guess.
 */
export function runtimeCall(input: {
  action: Action
  precondition: Precondition
  options: readonly ObservedOptionRef[]
  attachment: RenderedAttachment | null
}): RuntimeCall | null {
  const expect: RuntimeExpectation = {
    documentGeneration: input.precondition.documentGeneration,
    questionRevision: input.precondition.questionRevision,
    sourceBundleId: input.precondition.sourceBundleId,
    userEditEpoch: input.precondition.userEditEpoch,
    settleMs: DOM_AGENT_LIMITS.controlInteractionMs,
    expectedValue: null,
    expectedChecked: null,
    expectedOptionLabel: null,
  }
  const action = input.action
  switch (action.type) {
    case "write_text":
      return {
        step: { kind: "write_text", value: action.value },
        expect: { ...expect, expectedValue: action.expectedValue },
      }
    case "toggle":
      return {
        step: { kind: "toggle", checked: action.checked },
        expect: { ...expect, expectedChecked: action.expectedChecked },
      }
    case "select_option": {
      const chosen = labelFor(input.options, action.optionRef)
      if (chosen === null) return null
      const current =
        action.expectedOptionRef === null
          ? ""
          : labelFor(input.options, action.expectedOptionRef)
      if (current === null) return null
      return {
        step: { kind: "select_option", optionLabel: chosen },
        expect: { ...expect, expectedOptionLabel: current },
      }
    }
    case "attach_file": {
      // Replacing an attachment the user put there requires a specific reviewed
      // choice. Finding a conflict is not one, so an action that replaces
      // without a confirmation is expressed as nothing at all rather than
      // resolved into a guess about which file the user meant to keep.
      const authorized = attachmentIsAuthorized(action)
      if (!authorized) return null
      const attachment = input.attachment
      if (!attachment) return null
      // Cached bytes belong to the configuration that rendered them, and an
      // attachment is never verified by its name.
      if (attachment.identity !== action.pdfIdentity) return null
      return {
        step: {
          kind: "attach_file",
          file: {
            name: attachment.name,
            type: attachment.type,
            sizeBytes: attachment.sizeBytes,
            base64: attachment.base64,
          },
          replaceExisting: action.replaceExisting,
          replacementConfirmed: authorized,
        },
        expect,
      }
    }
    case "add_record_group":
      return { step: { kind: "add_record_group" }, expect }
    default: {
      action satisfies never
      return null
    }
  }
}

function labelFor(
  options: readonly ObservedOptionRef[],
  ref: string
): string | null {
  const found = options.find((option) => option.ref === ref)
  return found ? found.label : null
}
