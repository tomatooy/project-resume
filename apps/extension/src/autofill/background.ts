import { z } from "zod"
import { partitionSnapshot } from "./batches"
import { prepareResumePdf } from "./pdf-background"
import type { ResumePdf } from "./pdf-contract"
import { isAutofillApplicationUrl } from "./sites"
import { applicationIdentity, sameApplication } from "./application"
import { profileUpdateForAnswer } from "./profile-answer"
import { acceptConfirmation, rememberAnswer } from "./confirmed-answers"
import {
  AUTOFILL_LIMITS,
  ActionResultSchema,
  AutofillPlanOutputSchema,
  type ActionResult,
  type PlanInput,
  type FieldDecision,
  type ContextRead,
  ProfileUpdateSchema,
} from "@workspace/resume-core/contracts"
import { api, apiForAccount } from "../lib/api"
import { account, connect } from "../lib/auth"
import { config } from "../lib/config"
import {
  AutofillPanelError,
  ObservationSchema,
  AutoLaunchMessageSchema,
  ReplacementPreviewSchema,
  PanelCommandSchema,
  SessionSchema,
  PROTOCOL,
  type AutofillSession,
  type PanelState,
} from "./messages"

const LaunchSchema = z.strictObject({
  nonce: z.uuid(),
  tabId: z.number(),
  documentId: z.string(),
  origin: z.string(),
  instanceId: z.uuid(),
  epoch: z.number(),
  createdAt: z.number(),
  panelFrameId: z.number().int().positive().optional(),
  panelDocumentId: z.string().optional(),
})
type Launch = z.infer<typeof LaunchSchema>
const AssociationSchema = z.strictObject({
  accountId: z.string(),
  resumeId: z.uuid(),
  origin: z.string(),
  expiresAt: z.number(),
})
const sessions = new Map<number, AutofillSession>()
const running = new Map<number, AbortController>()
const openings = new Map<number, Promise<void>>()
const retired = new Set<string>()
const resumePages = new Map<
  string,
  { items: PanelState["resumes"]; nextCursor: string | null; at: number }
>()
async function bounded<T>(
  promise: Promise<T>,
  ms = AUTOFILL_LIMITS.stepMs + 500
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Content acknowledgement timed out")),
          ms
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const launchKey = (nonce: string) => `autofill:launch:${nonce}`
const sessionKey = (tabId: number) => `autofill:session:${tabId}`
const associationKey = (tabId: number) => `autofill:apply:${tabId}`
const autoLaunchKey = (tabId: number) => `autofill:auto:${tabId}`
export async function associateApplication(
  tabId: number,
  accountId: string,
  resumeId: string,
  url: string
) {
  await chrome.storage.session.set({
    [associationKey(tabId)]: {
      accountId,
      resumeId,
      origin: new URL(url).origin,
      expiresAt: Date.now() + AUTOFILL_LIMITS.sessionTtl,
    },
  })
}
async function store(session: AutofillSession) {
  if (retired.has(session.id)) return
  sessions.set(session.tabId, session)
  await chrome.storage.session.set({
    [sessionKey(session.tabId)]: {
      ...session,
      observation: null,
      replacementPreview: null,
      replacementPreviews: [],
      decisions: [],
      selections: [],
      status: session.status === "cancelled" ? "cancelled" : "paused",
      message: "Session restored. Observe the page and continue when ready.",
    },
  })
}
async function panelAccount() {
  return account().catch(() => {
    throw new AutofillPanelError("auth")
  })
}
async function restore(tabId: number): Promise<AutofillSession | null> {
  const live = sessions.get(tabId)
  const saved =
    live ??
    SessionSchema.safeParse(
      (await chrome.storage.session.get(sessionKey(tabId)))[sessionKey(tabId)]
    ).data
  if (!saved) return null
  if (!(await chrome.tabs.get(tabId).catch(() => null))) {
    await clear(tabId)
    return null
  }
  if ((await panelAccount())?.id !== saved.accountId) {
    await clear(tabId)
    return null
  }
  if (!live) {
    saved.status = "paused"
    saved.generation++
    sessions.set(tabId, saved)
  }
  return saved
}
async function clear(tabId: number) {
  running.get(tabId)?.abort()
  const session = sessions.get(tabId)
  if (session) {
    await stop(session, true)
    retired.add(session.id)
  }
  sessions.delete(tabId)
  await chrome.storage.session.remove([
    sessionKey(tabId),
    associationKey(tabId),
  ])
}
async function stop(session: AutofillSession, discard: boolean) {
  session.generation++
  session.status = "stopping"
  running.get(session.tabId)?.abort()
  const generation = session.generation
  const requestId = crypto.randomUUID()
  const acknowledged = await bounded(
    chrome.tabs.sendMessage(
      session.tabId,
      {
        type: "af.cancel",
        protocolVersion: PROTOCOL,
        sessionId: session.id,
        generation,
        requestId,
        instanceId: session.instanceId,
      },
      { documentId: session.documentId }
    )
  ).then(
    (reply) =>
      z
        .object({
          ok: z.literal(true),
          generation: z.literal(generation),
          requestId: z.literal(requestId),
        })
        .safeParse(reply).success,
    () => false
  )
  const current = await chrome.webNavigation
    .getFrame({ tabId: session.tabId, frameId: session.frameId })
    .catch(() => null)
  const destroyed = !current || current.documentId !== session.documentId
  if (session.generation !== generation) return
  session.status =
    acknowledged || destroyed ? (discard ? "cancelled" : "paused") : "stopping"
  session.message =
    acknowledged || destroyed
      ? "Stopped. Completed fields remain on the page."
      : "Waiting for the page to acknowledge Stop. Reload the application page before starting again."
  session.decisions = []
  session.selections = []
  session.observation = null
  session.replacementPreview = null
  session.replacementPreviews = []
  session.drafts = []
  if (discard) session.overrides = []
  await store(session)
}
async function frame(tabId: number, frameId: number) {
  const result = await chrome.webNavigation.getFrame({ tabId, frameId })
  if (!result?.documentId || !result.url.startsWith("https://"))
    throw new Error("This page is not available for autofill.")
  return result
}
export async function openAutofill(
  tab: chrome.tabs.Tab,
  automaticDocumentId?: string
): Promise<void> {
  if (tab.id === undefined) return
  const tabId = tab.id
  const pending = openings.get(tabId)
  if (pending) {
    await pending.catch(() => undefined)
    return openAutofill(tab, automaticDocumentId)
  }
  const opening = launchAutofill(tab, automaticDocumentId).finally(() => {
    if (openings.get(tabId) === opening) openings.delete(tabId)
  })
  openings.set(tabId, opening)
  return opening
}
async function launchAutofill(
  tab: chrome.tabs.Tab,
  automaticDocumentId?: string
): Promise<void> {
  if (tab.id === undefined || !tab.url?.startsWith("https://")) return
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  })
  const current = await frame(tab.id, 0)
  if (automaticDocumentId) {
    if (
      current.documentId !== automaticDocumentId ||
      !isAutofillApplicationUrl(current.url)
    )
      return
    const saved = await chrome.storage.session.get(autoLaunchKey(tab.id))
    if (saved[autoLaunchKey(tab.id)] === current.documentId) return
  }
  // A document-level tombstone keeps Close effective across worker restarts.
  await chrome.storage.session.set({
    [autoLaunchKey(tab.id)]: current.documentId,
  })
  const nonce = crypto.randomUUID()
  const launch: Launch = {
    nonce,
    tabId: tab.id,
    documentId: current.documentId,
    origin: new URL(current.url).origin,
    instanceId: crypto.randomUUID(),
    epoch: Date.now(),
    createdAt: Date.now(),
  }
  const old = await restore(tab.id)
  if (old) {
    const identity = applicationIdentity(current.url)
    const same =
      sameApplication(old.applicationKey, identity) ||
      (!old.applicationKey &&
        !identity &&
        old.documentId === current.documentId)
    if (!same) await clear(tab.id)
    else {
      await stop(old, false)
      if (old.documentId === current.documentId) {
        old.instanceId = launch.instanceId
        old.documentEpoch = launch.epoch
        await store(old)
      }
    }
  }
  const stored = await chrome.storage.session.get(null)
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith("autofill:launch:")) continue
    const previous = LaunchSchema.safeParse(value)
    if (previous.success && previous.data.tabId === tab.id)
      await chrome.storage.session.remove(key)
  }
  await chrome.storage.session.set({ [launchKey(nonce)]: launch })
  try {
    await inject(
      launch.tabId,
      current.documentId,
      launch.instanceId,
      launch.epoch,
      nonce
    )
  } catch {
    await chrome.storage.session.remove(launchKey(nonce))
  }
}
async function inject(
  tabId: number,
  documentId: string,
  instanceId: string,
  epoch: number,
  panelNonce?: string
) {
  const hello = await chrome.tabs
    .sendMessage(
      tabId,
      { type: "af.hello", protocolVersion: PROTOCOL },
      { documentId }
    )
    .catch(() => null)
  if (
    hello &&
    !z.object({ protocolVersion: z.literal(1) }).safeParse(hello).success
  )
    throw new Error("Reload this page to update the autofill script.")
  if (!hello)
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      files: ["autofill-content.js"],
    })
  await chrome.tabs.sendMessage(
    tabId,
    {
      type: "af.bootstrap",
      protocolVersion: PROTOCOL,
      instanceId,
      documentId,
      documentEpoch: epoch,
      panelNonce,
    },
    { documentId }
  )
}
async function trusted(
  sender: chrome.runtime.MessageSender,
  nonce: string
): Promise<Launch> {
  const data = LaunchSchema.safeParse(
    (await chrome.storage.session.get(launchKey(nonce)))[launchKey(nonce)]
  )
  if (
    !data.success ||
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL(`panel.html#autofill=${nonce}`) ||
    !sender.documentId
  )
    throw new AutofillPanelError("session")
  const launch = data.data
  if (launch.panelDocumentId && launch.panelDocumentId !== sender.documentId)
    throw new AutofillPanelError("session")
  if (
    sender.tab?.id !== launch.tabId ||
    sender.frameId === undefined ||
    sender.frameId <= 0 ||
    (sender.documentLifecycle && sender.documentLifecycle !== "active") ||
    (launch.panelFrameId !== undefined &&
      launch.panelFrameId !== sender.frameId)
  )
    throw new AutofillPanelError("session")
  // getFrame excludes extension URLs. Bind the private launch to its host document.
  const parent = await frame(launch.tabId, 0).catch(() => {
    throw new AutofillPanelError("session")
  })
  if (
    parent.documentId !== launch.documentId ||
    new URL(parent.url).origin !== launch.origin
  )
    throw new AutofillPanelError("session")
  launch.panelFrameId = sender.frameId
  launch.panelDocumentId = sender.documentId
  await chrome.storage.session.set({ [launchKey(nonce)]: launch })
  return launch
}
async function panelState(
  launch: Launch,
  cursor?: string
): Promise<PanelState> {
  const user = await panelAccount()
  const session = await restore(launch.tabId)
  let page = user ? resumePages.get(user.id) : undefined
  if (user && (cursor || !page || Date.now() - page.at > 60000)) {
    const fetched = await api.resumes
      .page({ cursor })
      .catch((error: unknown) => {
        throw new AutofillPanelError(
          z.object({ code: z.literal("UNAUTHENTICATED") }).safeParse(error)
            .success
            ? "auth"
            : "service"
        )
      })
    page = {
      items:
        cursor && page
          ? [
              ...new Map(
                [...page.items, ...fetched.items].map((item) => [item.id, item])
              ).values(),
            ]
          : fetched.items,
      nextCursor: fetched.nextCursor,
      at: Date.now(),
    }
    resumePages.set(user.id, page)
  }
  const saved = AssociationSchema.safeParse(
    (await chrome.storage.session.get(associationKey(launch.tabId)))[
      associationKey(launch.tabId)
    ]
  )
  let preselected =
    saved.success &&
    saved.data.accountId === user?.id &&
    saved.data.expiresAt > Date.now() &&
    saved.data.origin === launch.origin
      ? saved.data.resumeId
      : null
  if (session && user?.id === session.accountId) {
    const current = await frame(launch.tabId, 0)
    if (
      sameApplication(
        session.applicationKey,
        applicationIdentity(current.url)
      ) ||
      session.documentId === current.documentId
    )
      preselected = session.resumeId
  }
  if (
    preselected &&
    page &&
    !page.items.some((item) => item.id === preselected)
  ) {
    const summary = await api.resumes
      .summary({ id: preselected })
      .catch(() => null)
    if (summary) page.items = [...page.items, summary]
    else {
      preselected = null
      await chrome.storage.session.remove(associationKey(launch.tabId))
    }
  }
  if ((await panelAccount())?.id !== user?.id)
    throw new AutofillPanelError("auth")
  return {
    origin: launch.origin,
    account: user,
    resumes: page?.items ?? [],
    nextCursor: page?.nextCursor ?? null,
    preselected,
    session: session?.documentId === launch.documentId ? session : null,
  }
}
async function active(session: AutofillSession, generation: number) {
  if (
    session.generation !== generation ||
    (await account())?.id !== session.accountId
  )
    throw new Error("Session changed")
  const tab = await chrome.tabs.get(session.tabId)
  const window = await chrome.windows.get(tab.windowId)
  const current = await frame(session.tabId, session.frameId)
  if (
    !tab.active ||
    !window.focused ||
    current.documentId !== session.documentId ||
    new URL(current.url).origin !== session.origin ||
    (session.applicationKey !== null &&
      !sameApplication(
        session.applicationKey,
        applicationIdentity(current.url)
      ))
  )
    throw new Error("Page changed or lost focus")
}
async function run(session: AutofillSession) {
  if (running.has(session.tabId)) return
  const controller = new AbortController()
  running.set(session.tabId, controller)
  const generation = session.generation
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(AUTOFILL_LIMITS.runMs),
  ])
  const send = async (type: string, extra: object = {}) => {
    signal.throwIfAborted()
    await active(session, generation)
    const requestId = crypto.randomUUID()
    const reply = await bounded(
      chrome.tabs.sendMessage(
        session.tabId,
        {
          type,
          protocolVersion: PROTOCOL,
          sessionId: session.id,
          generation,
          requestId,
          instanceId: session.instanceId,
          ...extra,
        },
        { documentId: session.documentId }
      )
    )
    z.object({
      ok: z.literal(true),
      requestId: z.literal(requestId),
      generation: z.literal(generation),
    }).parse(reply)
    return reply
  }
  try {
    await active(session, generation)
    const client = await apiForAccount(session.accountId)
    await active(session, generation)
    const prepared = session.sourceSnapshot
      ? {
          sourceStamp: session.sourceSnapshot.sourceStamp,
          sourceSnapshot: session.sourceSnapshot,
        }
      : await client.autofill.prepare(
          { resumeId: session.resumeId },
          { signal }
        )
    await active(session, generation)
    if (
      !session.sourceSnapshot &&
      session.sourceStamp &&
      JSON.stringify({ ...session.sourceStamp, overridesRevision: 0 }) !==
        JSON.stringify(prepared.sourceStamp)
    ) {
      session.selections = []
      session.overrides = []
      session.sourceStamp = prepared.sourceStamp
      throw new Error(
        "Saved source changed. Review the updated information and continue."
      )
    }
    session.sourceStamp = {
      ...prepared.sourceStamp,
      overridesRevision: session.sourceStamp?.overridesRevision ?? 0,
    }
    session.sourceSnapshot = prepared.sourceSnapshot ?? null
    let resumePdf: ResumePdf | undefined
    const failedFields = new Set<string>()
    const failures = new Map<string, number>()
    const failedInteractions = new Set<string>()
    const failedEntries = new Set<string>()
    const recordAdditions = new Map<string, number>()
    const contextReads = new Set<string>()
    let contextRequests: ContextRead[] = []
    let contextRounds = 0
    const failed = (fieldId: string) => {
      const count = (failures.get(fieldId) ?? 0) + 1
      failures.set(fieldId, count)
      if (count >= 2) failedFields.add(fieldId)
      return count >= 2
    }
    const recordSelections = new Map<
      string,
      {
        selection: PlanInput["selections"][number]
        groupId?: string
        editEpoch: number
      }
    >()
    const rescans = new Map<string, number>()
    const consumeRescan = (key: string) => {
      const count = (rescans.get(key) ?? 0) + 1
      rescans.set(key, count)
      return count <= AUTOFILL_LIMITS.rescans
    }
    while (!signal.aborted) {
      session.status = "observing"
      await store(session)
      const observed = z
        .object({
          ok: z.literal(true),
          generation: z.number(),
          observation: ObservationSchema,
        })
        .parse(
          await send("af.observe", { formId: session.formId, contextRequests })
        )
      await active(session, generation)
      signal.throwIfAborted()
      session.observation = observed.observation
      if (!observed.observation.snapshot) {
        session.status = "paused"
        session.message = observed.observation.forms.length
          ? "Choose the application form, then fill this page."
          : "No supported application form detected."
        break
      }
      const snapshot = observed.observation.snapshot
      session.formId = snapshot.formId
      session.status = "planning"
      await store(session)
      const input: PlanInput = {
        automation: "automatic",
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        sessionId: session.id,
        generation,
        sourceStamp: session.sourceStamp,
        sourceSnapshot: session.sourceSnapshot ?? undefined,
        applicationContext: session.applicationContext,
        applicationAnswers: session.applicationAnswers,
        supplementalRecords: session.supplementalRecords,
        target: {
          tabId: session.tabId,
          frameId: session.frameId,
          documentId: session.documentId,
          origin: session.origin,
          formId: snapshot.formId,
        },
        snapshot,
        selections: [
          ...[...recordSelections.values()].flatMap(
            ({ selection, groupId, editEpoch }) => {
              const field = snapshot.fields.find(
                (f) => f.fieldId === selection.fieldId
              )
              return field &&
                field.fieldRevision === selection.fieldRevision &&
                field.groupId === groupId &&
                field.userEditEpoch === editEpoch &&
                !session.selections.some((s) => s.fieldId === field.fieldId)
                ? [{ ...selection, guardRef: field.guardRef }]
                : []
            }
          ),
          ...session.selections,
        ],
        overrides: session.overrides,
        countryCode: session.countryCode,
        remainingAttempts: Math.max(0, 8 - session.attempts),
      }
      const batches = partitionSnapshot(input)
      let response:
        | ReturnType<typeof AutofillPlanOutputSchema.parse>
        | undefined
      const batchBindings = new Map<string, string>()
      for (const batch of batches) {
        batch.recordBindings = [...batchBindings].map(
          ([groupId, recordId]) => ({ groupId, recordId })
        )
        batch.remainingAttempts = Math.max(
          0,
          input.remainingAttempts - (response?.attempts ?? 0)
        )
        const next = AutofillPlanOutputSchema.parse(
          await client.autofill.plan(batch, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          })
        )
        await active(session, generation)
        signal.throwIfAborted()
        if (
          next.requestId !== batch.requestId ||
          next.sessionId !== session.id ||
          next.generation !== generation ||
          next.snapshotId !== snapshot.snapshotId ||
          JSON.stringify(next.plan.sourceStamp) !==
            JSON.stringify(session.sourceStamp) ||
          JSON.stringify(next.plan.target) !== JSON.stringify(input.target)
        )
          throw new Error("Plan changed")
        for (const decision of next.decisions) {
          if (!decision.recordId) continue
          const groupId =
            next.interpretation?.fields.find(
              (field) => field.fieldId === decision.fieldId
            )?.groupId ??
            snapshot.fields.find((field) => field.fieldId === decision.fieldId)
              ?.groupId
          if (!groupId) continue
          const prior = batchBindings.get(groupId)
          if (prior && prior !== decision.recordId)
            throw new Error("Record binding changed")
          batchBindings.set(groupId, decision.recordId)
        }
        if (!response) response = next
        else {
          if (
            response.policy.version !== next.policy.version ||
            response.policy.enabled !== next.policy.enabled
          )
            throw new Error("Policy changed")
          response.decisions.push(...next.decisions)
          response.plan.actions.push(...next.plan.actions)
          response.plan.interactions.push(...next.plan.interactions)
          if (next.interpretation) {
            if (!response.interpretation)
              response.interpretation = next.interpretation
            else {
              response.interpretation.regions = [
                ...new Map(
                  [
                    ...response.interpretation.regions,
                    ...next.interpretation.regions,
                  ].map((region) => [region.regionRef, region])
                ).values(),
              ]
              response.interpretation.fields.push(...next.interpretation.fields)
              for (const group of next.interpretation.groups) {
                const prior = response.interpretation.groups.find(
                  (item) => item.groupId === group.groupId
                )
                if (!prior) response.interpretation.groups.push(group)
                else {
                  if (prior.kind !== group.kind)
                    throw new Error("Record group changed")
                  prior.fieldIds = [
                    ...new Set([...prior.fieldIds, ...group.fieldIds]),
                  ]
                  prior.evidenceRefs = [
                    ...new Set([...prior.evidenceRefs, ...group.evidenceRefs]),
                  ].slice(0, 20)
                }
              }
              response.interpretation.excluded.push(
                ...next.interpretation.excluded
              )
              response.interpretation.needsContext.push(
                ...next.interpretation.needsContext
              )
              response.interpretation.unresolvedFieldIds.push(
                ...next.interpretation.unresolvedFieldIds
              )
            }
          }
          response.attempts += next.attempts
          if (next.plan.expiresAt < response.plan.expiresAt)
            response.plan.expiresAt = next.plan.expiresAt
          if (next.policy.expiresAt < response.policy.expiresAt)
            response.policy.expiresAt = next.policy.expiresAt
        }
      }
      if (!response) throw new Error("No plan returned")
      session.attempts += response.attempts
      const needed =
        response.interpretation?.needsContext
          .filter(
            (request) =>
              !contextReads.has(`${request.fieldId}:${request.relation}`)
          )
          .slice(0, 8) ?? []
      if (
        needed.length &&
        contextRounds < 3 &&
        session.attempts < AUTOFILL_LIMITS.attempts
      ) {
        contextRequests = needed
        contextRounds++
        for (const request of needed)
          contextReads.add(`${request.fieldId}:${request.relation}`)
        continue
      }
      session.decisions = response.decisions
      session.status = "executing"
      await store(session)
      let barrier = false
      for (const action of response.plan.actions) {
        if (failedFields.has(action.fieldId)) continue
        let file: ResumePdf | undefined
        if (action.op === "upload_resume") {
          try {
            session.message = "Preparing and attaching your resume PDF…"
            await store(session)
            resumePdf ??= await prepareResumePdf(
              response.plan.sourceStamp,
              signal,
              session.sourceSnapshot ?? undefined,
              session.accountId
            )
            await active(session, generation)
            signal.throwIfAborted()
            const latest = session.sourceSnapshot
              ? { sourceStamp: session.sourceSnapshot.sourceStamp }
              : await client.autofill.prepare(
                  { resumeId: session.resumeId },
                  { signal }
                )
            if (
              JSON.stringify({
                ...latest.sourceStamp,
                overridesRevision: response.plan.sourceStamp.overridesRevision,
              }) !== JSON.stringify(response.plan.sourceStamp)
            )
              throw new Error(
                "Saved source changed. Review the updated information and continue."
              )
            if (Date.parse(response.plan.expiresAt) <= Date.now()) {
              barrier = true
              break
            }
            file = resumePdf
          } catch (error) {
            if (
              error instanceof Error &&
              error.message ===
                "Saved source changed. Review the updated information and continue."
            )
              throw error
            signal.throwIfAborted()
            await active(session, generation)
            failedFields.add(action.fieldId)
            session.results = [
              ...session.results.filter((r) => r.fieldId !== action.fieldId),
              {
                actionId: action.actionId,
                fieldId: action.fieldId,
                status: "failed",
                reasonCode: "resume_pdf_unavailable",
                verification: "not_attempted",
                durationMs: 0,
                observedFieldRevision: action.fieldRevision,
              } satisfies ActionResult,
            ].slice(-200)
            await store(session)
            continue
          }
        }
        const acknowledgement = z
          .object({ ok: z.literal(true), result: ActionResultSchema })
          .safeParse(
            await send("af.execute", {
              plan: { ...response.plan, actions: [action], interactions: [] },
              action,
              file,
              policy: response.policy,
              replacement: session.selections.find(
                (s) => s.fieldId === action.fieldId && s.replace
              ),
            }).catch(() => null)
          )
        signal.throwIfAborted()
        await active(session, generation)
        const reply = acknowledgement.success
          ? acknowledgement.data
          : {
              result: {
                actionId: action.actionId,
                fieldId: action.fieldId,
                status: "unverified",
                reasonCode: "acknowledgement_unavailable",
                verification: "unobservable",
                durationMs: 0,
                observedFieldRevision: action.fieldRevision,
              } satisfies ActionResult,
            }
        if (
          reply.result.actionId !== action.actionId ||
          reply.result.fieldId !== action.fieldId
        )
          throw new Error("Action acknowledgement changed")
        const result: ActionResult =
          session.generation === generation
            ? reply.result
            : {
                ...reply.result,
                status: "unverified",
                reasonCode: "interrupted_after_write",
                verification: "unobservable",
              }
        if (["filled", "already_applied"].includes(result.status)) {
          const decision = response.decisions.find(
            (d) => d.decisionId === action.decisionId
          )
          const field = snapshot.fields.find(
            (f) => f.fieldId === action.fieldId
          )
          if (decision?.recordId && decision.semanticKey && field)
            recordSelections.set(field.fieldId, {
              groupId: field.groupId,
              editEpoch: field.userEditEpoch,
              selection: {
                fieldId: field.fieldId,
                fieldRevision: field.fieldRevision,
                guardRef: field.guardRef,
                concept: decision.semanticKey,
                recordId: decision.recordId,
                confirmed: false,
                replace: false,
                profileRevision: response.plan.sourceStamp.profileRevision,
              },
            })
        }
        session.results = [
          ...session.results.filter((r) => r.fieldId !== action.fieldId),
          result,
        ].slice(-200)
        await store(session)
        await active(session, generation)
        signal.throwIfAborted()
        if (!["filled", "already_applied"].includes(result.status)) {
          if (!failed(action.fieldId)) {
            barrier = true
            break
          }
        }
        // Selections and dates can change downstream fields; observe before continuing.
        if (
          action.op !== "set_text" ||
          action.format === "iso_date" ||
          action.format === "iso_month"
        ) {
          barrier = true
          break
        }
      }
      if (barrier) continue
      const interaction = response.plan.interactions.find(
        (candidate) => !failedInteractions.has(candidate.fieldId)
      )
      if (interaction) {
        if (!consumeRescan(interaction.fieldId)) {
          failedInteractions.add(interaction.fieldId)
          continue
        }
        session.status = "interacting"
        await store(session)
        const discovered = z.object({ ok: z.literal(true) }).safeParse(
          await send("af.discover", {
            plan: {
              ...response.plan,
              actions: [],
              interactions: [interaction],
            },
            interaction,
          }).catch(() => null)
        )
        if (!discovered.success && failed(interaction.fieldId))
          failedInteractions.add(interaction.fieldId)
        continue
      }
      const entry = (observed.observation.recordEntrypoints ?? []).find(
        (candidate) => {
          if (failedEntries.has(candidate.entryRef)) return false
          const pageView = snapshot.pageView
          const regions = response.interpretation?.regions ?? []
          if (!pageView || !regions.length) return false
          const nodes = new Map(pageView.nodes.map((node) => [node.ref, node]))
          let ancestor: string | undefined = candidate.entryRef
          const visited = new Set<string>()
          let withinRegion = false
          while (ancestor && !visited.has(ancestor)) {
            visited.add(ancestor)
            if (regions.some((region) => region.regionRef === ancestor)) {
              withinRegion = true
              break
            }
            ancestor = nodes.get(ancestor)?.parentRef
          }
          if (!withinRegion) return false
          const records = [
            ...(session.sourceSnapshot?.resume.sections.flatMap(
              (section) => section.items
            ) ?? []),
            ...session.supplementalRecords.map((item) => item.record),
          ].filter((item) => item.kind === candidate.kind)
          const groups = (
            response.interpretation?.groups ?? snapshot.groups
          ).filter((group) => group.kind === candidate.kind)
          if (!groups.length || snapshot.coverage !== "complete") return false
          const bound = new Set<string>()
          for (const group of groups) {
            const recordId = batchBindings.get(group.groupId)
            if (
              !recordId ||
              bound.has(recordId) ||
              !records.some((record) => record.id === recordId)
            )
              return false
            bound.add(recordId)
            const fields =
              response.interpretation?.fields.filter(
                (field) => field.groupId === group.groupId
              ) ?? []
            if (
              !fields.length ||
              fields.some((field) => {
                const decision = response.decisions.find(
                  (item) => item.fieldId === field.fieldId
                )
                return (
                  !decision ||
                  ["review", "unmapped", "failed", "unsupported"].includes(
                    decision.status
                  )
                )
              })
            )
              return false
          }
          return (
            records.some((record) => !bound.has(record.id)) &&
            (recordAdditions.get(candidate.kind) ?? 0) < records.length
          )
        }
      )
      if (entry) {
        const added = z.object({ changed: z.literal(true) }).safeParse(
          await send("af.addRecord", {
            entryRef: entry.entryRef,
            entryRevision: entry.entryRevision,
            kind: entry.kind,
          }).catch(() => null)
        )
        recordAdditions.set(
          entry.kind,
          (recordAdditions.get(entry.kind) ?? 0) + 1
        )
        if (!added.success) failedEntries.add(entry.entryRef)
        continue
      }
      session.decisions = response.decisions.map((decision) =>
        failedFields.has(decision.fieldId) ||
        failedInteractions.has(decision.fieldId)
          ? {
              ...decision,
              status: "failed",
              reasonCode: "control_retry_exhausted",
            }
          : decision
      )
      const audit = z
        .object({ observation: ObservationSchema })
        .safeParse(
          await send("af.observe", { formId: session.formId }).catch(() => null)
        )
      if (audit.success && audit.data.observation.snapshot) {
        session.observation = audit.data.observation
        for (const field of audit.data.observation.snapshot.fields) {
          if (
            !session.decisions.some(
              (decision) => decision.fieldId === field.fieldId
            )
          )
            session.decisions.push({
              decisionId: crypto.randomUUID(),
              fieldId: field.fieldId,
              fieldRevision: field.fieldRevision,
              label: field.label,
              status: "unmapped",
              reasonCode: "not_processed",
            } satisfies FieldDecision)
          const completed = session.results.find(
            (result) =>
              result.fieldId === field.fieldId && result.status === "filled"
          )
          if (
            completed &&
            (field.state.empty || field.state.validationState === "invalid")
          ) {
            completed.status = "unverified"
            completed.verification = "unobservable"
            completed.reasonCode = "final_readback_changed"
          }
        }
      }
      const verification = z
        .object({ results: z.array(ActionResultSchema) })
        .safeParse(await send("af.audit").catch(() => null))
      for (const result of session.results) {
        if (!["filled", "already_applied"].includes(result.status)) continue
        const verified = verification.success
          ? verification.data.results.find(
              (item) =>
                item.actionId === result.actionId &&
                item.fieldId === result.fieldId
            )
          : undefined
        if (verified) Object.assign(result, verified)
        else {
          result.status = "unverified"
          result.verification = "unobservable"
          result.reasonCode = "final_readback_unavailable"
        }
      }
      session.status = "completed"
      const remaining = session.decisions.filter(
        (d) =>
          (!/^page_(navigation|search|authentication|not_application)$/.test(
            d.reasonCode
          ) &&
            !["resolved", "preserved"].includes(d.status)) ||
          session.results.some(
            (r) =>
              r.fieldId === d.fieldId &&
              !["filled", "already_applied"].includes(r.status)
          )
      ).length
      session.message = `${audit.success && audit.data.observation.snapshot ? "Current page checked." : "Final page check was unavailable. Review filled values."} ${remaining} items need your attention.${session.observation?.uncovered ? " Some page content could not be observed." : ""}`
      break
    }
    if (!["completed", "paused"].includes(session.status)) {
      session.status = "paused"
      session.message =
        "Rescan budget reached. Check the completed fields, then continue."
    }
  } catch (error) {
    if (session.generation === generation) {
      await stop(session, false)
      if (session.status !== "stopping") session.status = "paused"
      session.message =
        error instanceof Error &&
        [
          "Saved source changed. Review the updated information and continue.",
          "This control needs manual attention. Existing input is preserved.",
        ].includes(error.message)
          ? error.message
          : "Paused. Check the page and saved information, then continue."
    }
  } finally {
    if (running.get(session.tabId) === controller) running.delete(session.tabId)
    await store(session)
  }
}
async function expireSessions() {
  const stored = await chrome.storage.session.get(null)
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith("autofill:session:")) {
      const session = SessionSchema.safeParse(value)
      if (
        session.success &&
        !(await chrome.tabs.get(session.data.tabId).catch(() => null))
      ) {
        sessions.set(session.data.tabId, session.data)
        await clear(session.data.tabId)
      }
    } else if (key.startsWith("autofill:launch:")) {
      const launch = LaunchSchema.safeParse(value)
      if (
        !launch.success ||
        !(await chrome.tabs.get(launch.data.tabId).catch(() => null))
      )
        await chrome.storage.session.remove(key)
    } else if (key.startsWith("autofill:apply:")) {
      const association = AssociationSchema.safeParse(value)
      if (!association.success || association.data.expiresAt <= Date.now())
        await chrome.storage.session.remove(key)
    }
  }
}
export function registerAutofill() {
  void chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  })
  void chrome.alarms.create("autofill:expire", { periodInMinutes: 1 })
  void expireSessions()
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "autofill:expire") void expireSessions()
  })
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (AutoLaunchMessageSchema.safeParse(raw).success) {
      if (
        sender.id !== chrome.runtime.id ||
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        !sender.documentId ||
        !sender.url ||
        !isAutofillApplicationUrl(sender.url)
      )
        return false
      void openAutofill(
        { ...sender.tab, url: sender.url },
        sender.documentId
      ).then(
        () => respond({ ok: true }),
        () => respond({ ok: false })
      )
      return true
    }
    const intervention = z
      .object({
        type: z.literal("af.userIntervened"),
        protocolVersion: z.literal(1),
        instanceId: z.uuid(),
        sessionId: z.uuid(),
        generation: z.number(),
      })
      .safeParse(raw)
    if (
      intervention.success &&
      sender.id === chrome.runtime.id &&
      sender.tab?.id !== undefined
    ) {
      const session = sessions.get(sender.tab.id)
      if (
        session &&
        sender.documentId === session.documentId &&
        sender.frameId === session.frameId &&
        intervention.data.instanceId === session.instanceId &&
        intervention.data.sessionId === session.id &&
        intervention.data.generation === session.generation
      )
        void stop(session, false)
      return false
    }
    const parsed = PanelCommandSchema.safeParse(raw)
    if (!parsed.success) return false
    void (async () => {
      const command = parsed.data
      const launch = await trusted(sender, command.nonce)
      if (command.type === "af.close") {
        const session = await restore(launch.tabId)
        if (session) {
          await stop(session, false)
          if (session.status === "stopping")
            throw new Error("Stop is not acknowledged")
        }
        const state = await panelState(launch)
        const requestId = crypto.randomUUID()
        const generation = (session?.generation ?? 0) + 1
        const released = await bounded(
          chrome.tabs.sendMessage(
            launch.tabId,
            {
              type: "af.release",
              protocolVersion: PROTOCOL,
              sessionId: session?.id ?? crypto.randomUUID(),
              generation,
              requestId,
              instanceId: launch.instanceId,
            },
            { documentId: launch.documentId }
          )
        ).catch(() => null)
        z.object({
          ok: z.literal(true),
          generation: z.literal(generation),
          requestId: z.literal(requestId),
        }).parse(released)
        await chrome.storage.session.remove([launchKey(launch.nonce)])
        return state
      }
      if (command.type === "af.state" || command.type === "af.resumes")
        return panelState(
          launch,
          command.type === "af.resumes" ? command.cursor : undefined
        )
      if (command.type === "af.connect") {
        await connect().catch(() => {
          throw new AutofillPanelError("auth")
        })
        return panelState(launch)
      }
      const user = await panelAccount()
      if (!user) throw new AutofillPanelError("auth")
      if (command.type === "af.profile") {
        await chrome.tabs.create({
          url: `${config().appOrigin}/autofill-profile?section=${command.section}`,
        })
        return panelState(launch)
      }
      if (command.type === "af.start") {
        const old = await restore(launch.tabId)
        const current = await frame(launch.tabId, 0)
        const identity = applicationIdentity(current.url)
        const reuse =
          old &&
          old.accountId === user.id &&
          old.resumeId === command.resumeId &&
          (sameApplication(old.applicationKey, identity) ||
            (!old.applicationKey &&
              !identity &&
              old.documentId === current.documentId))
        if (old) {
          await stop(old, !reuse)
          if (old.status === "stopping")
            throw new Error("Stop is not acknowledged")
          if (!reuse) retired.add(old.id)
        }
        if (running.has(launch.tabId))
          throw new Error("The previous step is stopping. Try again shortly.")
        if (current.documentId !== launch.documentId)
          throw new Error("Document changed")
        const session: AutofillSession = {
          id: reuse ? old.id : crypto.randomUUID(),
          generation: (old?.generation ?? 0) + 1,
          accountId: user.id,
          resumeId: command.resumeId,
          sourceStamp: reuse ? old.sourceStamp : null,
          sourceSnapshot: reuse ? old.sourceSnapshot : null,
          applicationKey: identity,
          applicationContext: reuse ? old.applicationContext : undefined,
          applicationAnswers: reuse ? old.applicationAnswers : [],
          supplementalRecords: reuse ? old.supplementalRecords : [],
          savedAnswerIds: reuse ? old.savedAnswerIds : [],
          drafts: [],
          tabId: launch.tabId,
          frameId: 0,
          documentId: current.documentId,
          origin: new URL(current.url).origin,
          instanceId: launch.instanceId,
          documentEpoch: launch.epoch,
          formId: command.formId,
          countryCode: command.countryCode,
          status: "preparing",
          message: "Reading this application form…",
          updatedAt: Date.now(),
          decisions: [],
          results: [],
          selections: [],
          overrides: [],
          observation: null,
          attempts: 0,
          replacementPreview: null,
          replacementPreviews: [],
        }
        session.applicationContext ??= {
          applicationId: session.id,
          jobId: identity && identity.length <= 500 ? identity : undefined,
          countryCode: command.countryCode,
          currency: command.currency,
          salaryPeriod: command.salaryPeriod,
        }
        if (reuse) {
          session.countryCode = command.countryCode ?? old.countryCode
          session.applicationContext = {
            ...session.applicationContext,
            countryCode: session.countryCode,
            currency: command.currency ?? session.applicationContext.currency,
            salaryPeriod:
              command.salaryPeriod ?? session.applicationContext.salaryPeriod,
          }
        }
        await store(session)
        void run(session)
      } else {
        const session = await restore(launch.tabId)
        if (
          !session ||
          command.sessionId !== session.id ||
          command.generation !== session.generation
        )
          throw new Error("Session changed. Refresh the panel.")
        await active(session, session.generation)
        if (command.type === "af.cancel") await stop(session, false)
        else if (command.type === "af.saveAnswer") {
          if (running.has(launch.tabId))
            throw new Error("Wait for this run to finish")
          const generation = session.generation
          const client = await apiForAccount(session.accountId)
          await active(session, generation)
          const answer = session.applicationAnswers.find(
            (item) => item.answerId === command.answerId
          )
          if (!answer) throw new Error("Answer changed")
          if (session.savedAnswerIds.includes(answer.answerId))
            throw new Error("Answer already saved")
          if (command.destination === "profile") {
            const profile = await client.autofillProfile.get({})
            await active(session, generation)
            const update = profileUpdateForAnswer(profile, answer)
            if (!update)
              throw new Error("This answer needs specific reuse conditions")
            await client.autofillProfile.update(
              ProfileUpdateSchema.parse(update)
            )
          } else {
            if (!command.conditions) throw new Error("Choose reuse conditions")
            await client.autofillAnswers.save({
              expectedRevision: 0,
              meaning: answer.meaning,
              conditions: command.conditions,
              value: answer.value,
              provenance: answer.provenance,
              confirmed: true,
            })
          }
          await active(session, generation)
          if (!session.savedAnswerIds.includes(answer.answerId))
            session.savedAnswerIds.push(answer.answerId)
          session.message =
            "Answer saved. This application's original sources remain pinned."
          await store(session)
        } else if (command.type === "af.captureAnswer") {
          if (running.has(launch.tabId))
            throw new Error("Wait for this run to finish")
          const field = session.observation?.snapshot?.fields.find(
            (item) => item.fieldId === command.fieldId
          )
          const preview = session.replacementPreviews.find(
            (item) => item.fieldId === command.fieldId
          )
          if (
            !field ||
            !preview ||
            preview.fieldId !== field.fieldId ||
            preview.guardRef !== field.guardRef ||
            preview.fieldRevision !== field.fieldRevision
          )
            throw new Error("Preview the current answer first")
          const requestId = crypto.randomUUID()
          const captureGeneration = session.generation
          const current = z
            .object({
              ok: z.literal(true),
              requestId: z.literal(requestId),
              generation: z.literal(session.generation),
              preview: ReplacementPreviewSchema,
            })
            .parse(
              await bounded(
                chrome.tabs.sendMessage(
                  session.tabId,
                  {
                    type: "af.preview",
                    protocolVersion: PROTOCOL,
                    sessionId: session.id,
                    generation: session.generation,
                    requestId,
                    instanceId: session.instanceId,
                    fieldId: command.fieldId,
                  },
                  { documentId: session.documentId }
                )
              )
            )
          await active(session, captureGeneration)
          if (JSON.stringify(current.preview) !== JSON.stringify(preview))
            throw new Error("Answer changed. Preview it again.")
          rememberAnswer(session, field, command.concept, preview.value)
          session.message =
            "Answer confirmed for this application. Saving it for future use is a separate choice."
          await store(session)
        } else if (command.type === "af.draft") {
          if (running.has(launch.tabId) || !session.sourceStamp)
            throw new Error("Wait for this run to finish")
          const field = session.observation?.snapshot?.fields.find(
            (item) => item.fieldId === command.fieldId
          )
          const decision = session.decisions.find(
            (item) => item.fieldId === command.fieldId
          )
          if (!field || !decision || decision.status !== "needs_draft")
            throw new Error("Observe this question first")
          const generation = session.generation
          const client = await apiForAccount(session.accountId)
          await active(session, generation)
          const draft = await client.autofill.draft({
            sourceStamp: session.sourceStamp,
            sourceSnapshot: session.sourceSnapshot ?? undefined,
            target: {
              tabId: session.tabId,
              frameId: session.frameId,
              documentId: session.documentId,
              origin: session.origin,
              formId: session.observation?.snapshot?.formId ?? "page",
            },
            field,
            countryCode: session.countryCode,
            applicationContext: session.applicationContext,
            applicationAnswers: session.applicationAnswers,
            supplementalRecords: session.supplementalRecords,
          })
          await active(session, generation)
          if (draft.fieldRevision !== field.fieldRevision)
            throw new Error("Question changed")
          session.drafts = [
            ...session.drafts.filter((item) => item.fieldId !== field.fieldId),
            {
              fieldId: field.fieldId,
              question: field.label,
              text: draft.text,
              factIds: draft.citations.map((item) => item.evidenceId),
              missingInformation: draft.missingInformation,
            },
          ]
          session.message = draft.text
            ? "Draft ready. Review it before confirming this answer."
            : "More information is needed to write this answer."
          await store(session)
        } else if (command.type === "af.preview") {
          if (running.has(launch.tabId))
            throw new Error("Wait for this run to finish")
          const requestId = crypto.randomUUID()
          const reply = z
            .object({
              ok: z.literal(true),
              requestId: z.literal(requestId),
              generation: z.literal(session.generation),
              preview: ReplacementPreviewSchema,
            })
            .parse(
              await bounded(
                chrome.tabs.sendMessage(
                  session.tabId,
                  {
                    type: "af.preview",
                    protocolVersion: PROTOCOL,
                    sessionId: session.id,
                    generation: session.generation,
                    requestId,
                    instanceId: session.instanceId,
                    fieldId: command.fieldId,
                  },
                  { documentId: session.documentId }
                )
              )
            )
          if (reply.preview.fieldId !== command.fieldId)
            throw new Error("Field changed")
          session.replacementPreview = reply.preview
          session.replacementPreviews = [
            ...session.replacementPreviews.filter(
              (item) => item.fieldId !== command.fieldId
            ),
            reply.preview,
          ]
        } else {
          if (running.has(launch.tabId) || session.status === "stopping")
            throw new Error("Wait for the current step to finish.")
          const staged = structuredClone(session)
          if (command.selection)
            acceptConfirmation(staged, command.selection, command.override)
          else if (command.override)
            throw new Error("Confirm the field before supplying an answer")
          for (const confirmation of command.confirmations ?? [])
            acceptConfirmation(
              staged,
              confirmation.selection,
              confirmation.override
            )
          if (command.supplementalRecord) {
            if (
              command.supplementalRecord.applicationId !==
              session.applicationContext?.applicationId
            )
              throw new Error("Application changed")
            staged.supplementalRecords = [
              ...staged.supplementalRecords.filter(
                (item) =>
                  item.record.id !== command.supplementalRecord?.record.id
              ),
              command.supplementalRecord,
            ]
            if (staged.sourceStamp) staged.sourceStamp.overridesRevision++
          }
          Object.assign(session, staged)
          session.replacementPreview = null
          session.replacementPreviews = []
          session.generation++
          session.attempts = 0
          session.updatedAt = Date.now()
          session.status = "preparing"
          await store(session)
          void run(session)
        }
      }
      return panelState(launch)
    })().then(
      (state) => respond({ ok: true, state }),
      (error: unknown) => {
        const failure =
          error instanceof AutofillPanelError
            ? error
            : new AutofillPanelError("unavailable")
        respond({ ok: false, code: failure.code, message: failure.message })
      }
    )
    return true
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("resume-extension-auth" in changes)) return
    void account()
      .then(async (user) => {
        for (const s of sessions.values())
          if (s.accountId !== user?.id) await clear(s.tabId)
        for (const id of resumePages.keys())
          if (id !== user?.id) resumePages.delete(id)
      })
      .catch(async () => {
        for (const s of sessions.values()) await clear(s.tabId)
      })
  })
  chrome.tabs.onRemoved.addListener((id) => {
    void clear(id)
    void chrome.storage.session.remove(autoLaunchKey(id))
    void chrome.storage.session.get(null).then(async (values) => {
      for (const [key, value] of Object.entries(values)) {
        if (!key.startsWith("autofill:launch:")) continue
        const launch = LaunchSchema.safeParse(value)
        if (launch.success && launch.data.tabId === id)
          await chrome.storage.session.remove(key)
      }
    })
  })
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    for (const s of sessions.values())
      if (s.tabId !== tabId && running.has(s.tabId)) void stop(s, false)
  })
  chrome.windows.onFocusChanged.addListener((id) => {
    for (const s of sessions.values())
      if (running.has(s.tabId))
        void chrome.tabs
          .get(s.tabId)
          .then((tab) => {
            if (tab.windowId !== id) return stop(s, false)
          })
          .catch(() => undefined)
  })
  chrome.permissions.onRemoved.addListener(() => {
    for (const s of sessions.values()) void stop(s, true)
  })
  chrome.webNavigation.onCommitted.addListener(
    ({ tabId, frameId, documentId, url }) => {
      void restore(tabId)
        .then(async (s) => {
          if (s && s.frameId === frameId && s.documentId !== documentId)
            await (sameApplication(s.applicationKey, applicationIdentity(url))
              ? stop(s, false)
              : clear(tabId))
        })
        .catch(() => undefined)
    }
  )
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    ({ tabId, frameId, url }) => {
      void restore(tabId)
        .then(async (s) => {
          if (s && s.frameId === frameId)
            await (sameApplication(s.applicationKey, applicationIdentity(url))
              ? stop(s, false)
              : clear(tabId))
        })
        .catch(() => undefined)
    }
  )
}
