import { classifyField } from "@workspace/autofill"
import type { Fill, LocationTarget, Option } from "@workspace/autofill/fields"
import { locationTarget } from "@workspace/autofill/location"
import { fieldIdentity } from "../../autofill/field-identity"
import { api } from "../../lib/api"
import type { ContentMessage } from "../../lib/autofill-protocol"
import { type AutofillFrame, frameVisible, sameDocument } from "./frames"
import {
  type AutofillSession,
  countsOf,
  readSession,
  updateSession,
} from "./session"

type Request = Extract<ContentMessage, { type: "autofill-resolve-location" }>
type Pending = {
  tabId: number
  session: AutofillSession
  targets: Map<string, LocationTarget>
  calls: Map<string, { signature: string; result: Promise<Option | null> }>
  selections: Map<string, Option>
}
const pending = new Map<string, Pending>()

/** A content script may resolve only a search the worker is currently writing. */
export async function withLocationResolution<T>(
  tabId: number,
  session: AutofillSession,
  fills: Fill[],
  send: (requestId: string) => Promise<T>
): Promise<{ reply: T; selections: Map<string, Option> }> {
  const targets = new Map<string, LocationTarget>()
  for (const fill of fills) {
    if (fill.kind !== "search") continue
    const field = session.fields.find(({ id }) => id === fill.fieldId)
    if (!field) continue
    const { key } = classifyField(session.vendor, field)
    if (key !== "address.location" && key !== "address.city") continue
    const target = fill.location ?? locationTarget(fill.target)
    if (target) targets.set(fill.fieldId, target)
  }
  const requestId = crypto.randomUUID()
  const selections = new Map<string, Option>()
  pending.set(requestId, {
    tabId,
    session,
    targets,
    calls: new Map(),
    selections,
  })
  try {
    return { reply: await send(requestId), selections }
  } finally {
    pending.delete(requestId)
  }
}

export async function resolveLocationRequest(
  tabId: number,
  frame: AutofillFrame,
  message: Request
): Promise<Option | null> {
  const request = pending.get(message.requestId)
  const target = request?.targets.get(message.fieldId)
  if (
    !request ||
    !target ||
    request.tabId !== tabId ||
    !sameDocument(request.session, frame)
  )
    return null
  const signature = JSON.stringify(message.options)
  const previous = request.calls.get(message.fieldId)
  if (previous) return previous.signature === signature ? previous.result : null
  const current = async (): Promise<AutofillSession | null> => {
    const session = await readSession(tabId)
    const expected = request.session.fields.find(
      ({ id }) => id === message.fieldId
    )
    const field = session?.fields.find(({ id }) => id === message.fieldId)
    return pending.get(message.requestId) === request &&
      session &&
      expected &&
      field &&
      sameDocument(session, frame) &&
      session.postingKey === request.session.postingKey &&
      session.resumeId === request.session.resumeId &&
      session.form &&
      session.states[message.fieldId]?.owned !== true &&
      fieldIdentity(expected) === fieldIdentity(field)
      ? session
      : null
  }
  const resolve = async (): Promise<Option | null> => {
    const session = await current()
    if (
      !session?.started ||
      !session.postingKey ||
      session.quota?.remaining === 0 ||
      (await frameVisible(tabId, frame)) === false
    )
      return null
    const result = await api.autofill.resolveLocation(
      {
        page: {
          vendor: session.vendor,
          postingKey: session.postingKey,
          url: session.url,
          ...session.page,
        },
        resumeId: session.started.resumeId,
        applicationId: session.started.applicationId,
        useJob: false,
        counts: countsOf(session),
        target,
        options: message.options,
      },
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!(await current()) || (await frameVisible(tabId, frame)) === false)
      return null
    await updateSession(tabId, (latest) =>
      latest && sameDocument(latest, session)
        ? { ...latest, quota: result.quota }
        : latest
    )
    const selected =
      (result.option &&
        message.options.find(
          ({ id, label }) =>
            id === result.option?.id && label === result.option.label
        )) ||
      null
    if (selected) request.selections.set(message.fieldId, selected)
    return selected
  }
  const result = resolve().catch(() => null)
  request.calls.set(message.fieldId, { signature, result })
  return result
}
