import {
  AUTOFILL_LIMITS,
  isResumeUpload,
  acceptsResumePdf,
  type FillPlan,
  type FillAction,
  type ActionResult,
  type AutofillPolicy,
} from "@workspace/resume-core/contracts"
import {
  type Registry,
  committed,
  emptyValue,
  nameOf,
  optionContainer,
  readOptions,
  textOf,
  visible,
  availableControl,
  editable,
  commitState,
  validationState,
  type Entry,
} from "./registry"
import { fieldFingerprint, fieldLabel } from "./scanner"
import { buttonChoice, canClickChoice } from "./button-choice"
import { pdfBytes, type ResumePdf } from "./pdf-contract"
import { closestInPage, isTextEditor } from "./dom"
import {
  PageReader,
  recordEntrypointFingerprint,
  safeRecordButton,
} from "./page-reader"

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
export function setInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const proto =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
}
function present(element: HTMLElement) {
  element.scrollIntoView?.({
    block: "center",
    inline: "nearest",
    behavior: "auto",
  })
  element.focus({ preventScroll: true })
}
function safeClick(element: HTMLElement): boolean {
  return (
    !(element instanceof HTMLAnchorElement) &&
    !(element instanceof HTMLButtonElement && !canClickChoice(element)) &&
    !element.querySelector(
      'a[href],button:not([type="button"]),input[type="submit"]'
    )
  )
}
export class Executor {
  generation = 0
  sessionId = ""
  cancelled = true
  readonly journal = new Map<string, ActionResult | null>()
  private readonly successful = new Map<
    string,
    { action: FillAction; entry: Entry; result: ActionResult; value: string }
  >()
  private readonly uploads = new Map<string, File>()
  constructor(
    private readonly registry: Registry,
    private readonly documentId: string,
    private readonly active: () => boolean = () =>
      document.visibilityState === "visible"
  ) {}
  authorize(sessionId: string, generation: number) {
    if (
      generation < this.generation ||
      (this.cancelled && this.sessionId && generation === this.generation)
    )
      throw new Error("stale_generation")
    if (this.sessionId && this.sessionId !== sessionId) this.successful.clear()
    this.sessionId = sessionId
    this.generation = generation
    this.cancelled = false
  }
  cancel(generation: number) {
    this.generation = Math.max(generation, this.generation)
    this.cancelled = true
  }
  private current(plan: FillPlan, checkStructure = true): boolean {
    return (
      !this.cancelled &&
      plan.sessionId === this.sessionId &&
      plan.generation === this.generation &&
      plan.target.documentId === this.documentId &&
      plan.target.origin === location.origin &&
      plan.target.formId === this.registry.formId &&
      (!checkStructure || this.registry.validStructure()) &&
      plan.documentEpoch === this.registry.documentEpoch &&
      plan.formRevision === this.registry.formRevision &&
      Date.parse(plan.expiresAt) > Date.now() &&
      this.active()
    )
  }
  private guard(plan: FillPlan, action: FillAction, entry: Entry): boolean {
    const label = fieldLabel(entry.element, entry.group, entry.elements)
    return (
      this.current(plan) &&
      entry.element.isConnected &&
      closestInPage(
        entry.element,
        'fieldset,[data-autofill-record],[role="group"],[role="radiogroup"]'
      ) === entry.group &&
      availableControl(entry.element) &&
      editable(entry.element) &&
      action.fieldRevision === entry.revision &&
      action.guardRef === entry.guard &&
      action.userEditEpoch === entry.edits &&
      entry.before === committed(entry) &&
      entry.commitKnown === (commitState(entry) === "known") &&
      fieldFingerprint(entry.element, label, entry.snapshot.groupId) ===
        entry.fingerprint
    )
  }
  async execute(
    plan: FillPlan,
    action: FillAction,
    policy: AutofillPolicy,
    replace = false,
    file?: ResumePdf
  ): Promise<ActionResult> {
    const started = Date.now()
    const entry = this.registry.entries.get(action.fieldId)
    const result = (
      status: ActionResult["status"],
      reasonCode: string,
      verification: ActionResult["verification"] = "not_attempted"
    ): ActionResult => {
      const value: ActionResult = {
        actionId: action.actionId,
        fieldId: action.fieldId,
        status,
        reasonCode,
        verification,
        durationMs: Date.now() - started,
        observedFieldRevision: entry?.revision ?? 0,
      }
      this.journal.set(action.actionId, value)
      if (entry && (status === "filled" || status === "already_applied"))
        this.successful.set(action.fieldId, {
          action,
          entry,
          result: value,
          value: committed(entry),
        })
      return value
    }
    if (
      !entry ||
      !this.current(plan) ||
      !policy.enabled ||
      Date.parse(policy.expiresAt) <= Date.now() ||
      policy.disabledAdapters.includes(entry.snapshot.capabilities.adapterId)
    )
      return result("stale", "session_changed")
    if (this.journal.has(action.actionId))
      return fieldFingerprint(
        entry.element,
        fieldLabel(entry.element, entry.group, entry.elements),
        entry.snapshot.groupId
      ) === entry.fingerprint && this.matches(entry, action)
        ? result("already_applied", "observed_expected_value", "accepted")
        : result("stale", "observe_before_retry")
    if (!this.guard(plan, action, entry))
      return result("stale", "field_changed")
    if (
      action.precondition === "explicit_replace"
        ? !replace
        : !emptyValue(committed(entry))
    )
      return result("skipped", "existing_value")
    if (action.op === "set_single" || action.op === "set_multiple") {
      const options = readOptions(entry)
      const ids =
        action.op === "set_single" ? [action.optionId] : action.optionIds
      if (
        options.loadState !== "ready" ||
        options.optionsRevision !== action.optionsRevision ||
        options.queryRevision !== action.queryRevision ||
        ids.some(
          (id) =>
            !options.options.some(
              (o) => o.optionId === id && !o.disabled && !o.placeholder
            )
        )
      )
        return result("stale", "options_changed")
    }
    this.journal.set(action.actionId, null)
    try {
      if (!this.guard(plan, action, entry))
        return result("stale", "field_changed")
      const el = entry.element
      present(el)
      if (!this.guard(plan, action, entry))
        return result("stale", "field_changed")
      if (action.op === "upload_resume") {
        if (
          !(el instanceof HTMLInputElement) ||
          el.type !== "file" ||
          el.webkitdirectory ||
          !file ||
          !isResumeUpload(entry.snapshot) ||
          !acceptsResumePdf(el.accept) ||
          (el.files?.length ?? 0) > 0 ||
          JSON.stringify(file.sourceStamp) !== JSON.stringify(plan.sourceStamp)
        )
          return result("unsupported", "resume_upload_unavailable")
        const bytes = await pdfBytes(file)
        // Hashing is asynchronous; recheck the target before disclosing the file.
        if (!this.guard(plan, action, entry))
          return result("stale", "field_changed")
        const attached = new File([bytes], file.filename, {
          type: "application/pdf",
        })
        const transfer = new DataTransfer()
        transfer.items.add(attached)
        this.uploads.set(action.actionId, attached)
        el.files = transfer.files
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
        el.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
      } else if (
        action.op === "set_text" &&
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      )
        setInput(el, action.value)
      else if (action.op === "set_text" && isTextEditor(el)) {
        const before = new InputEvent("beforeinput", {
          inputType: "insertReplacementText",
          data: action.value,
          bubbles: true,
          composed: true,
          cancelable: true,
        })
        if (!el.dispatchEvent(before))
          return result("failed", "control_rejected", "rejected")
        el.textContent = action.value
        el.dispatchEvent(
          new InputEvent("input", {
            inputType: "insertReplacementText",
            data: action.value,
            bubbles: true,
            composed: true,
          })
        )
        el.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
      } else if (
        action.op === "set_checked" &&
        el instanceof HTMLInputElement &&
        el.type === "checkbox"
      ) {
        if (el.checked !== action.checked) el.click()
      } else if (
        action.op === "set_checked" &&
        ["checkbox", "switch"].includes(el.getAttribute("role") ?? "") &&
        safeClick(el)
      ) {
        if ((el.getAttribute("aria-checked") === "true") !== action.checked)
          el.click()
      } else if (action.op === "set_single" || action.op === "set_multiple") {
        const ids =
          action.op === "set_single" ? [action.optionId] : action.optionIds
        if (el instanceof HTMLSelectElement) {
          for (const [id, option] of entry.options)
            if (option.element instanceof HTMLOptionElement)
              option.element.selected = ids.includes(id)
          el.dispatchEvent(new Event("input", { bubbles: true }))
          el.dispatchEvent(new Event("change", { bubbles: true }))
        } else {
          for (const [id, option] of entry.options) {
            const checkbox =
              option.element instanceof HTMLInputElement &&
              option.element.type === "checkbox"
            const change = checkbox
              ? option.element instanceof HTMLInputElement &&
                option.element.checked !== ids.includes(id)
              : ids.includes(id)
            if (!change) continue
            if (
              !this.current(plan) ||
              entry.edits !== action.userEditEpoch ||
              !visible(option.element)
            )
              return result("stale", "interrupted")
            const choice = buttonChoice(el)
            const currentValue = choice
              ? (option.element.getAttribute("data-option") ?? "")
              : option.element instanceof HTMLInputElement ||
                  option.element instanceof HTMLOptionElement
                ? option.element.value
                : (option.element.getAttribute("data-value") ??
                  (option.element.id || textOf(option.element)))
            const currentLabel =
              option.element instanceof HTMLInputElement
                ? nameOf(option.element)
                : textOf(option.element)
            if (
              `${currentValue}:${currentLabel}:${option.element.getAttribute("aria-disabled") ?? ""}` !==
              option.fingerprint
            )
              return result("stale", "option_recycled")
            if (
              option.element instanceof HTMLInputElement &&
              (option.element.type === "checkbox" ||
                option.element.type === "radio")
            )
              option.element.click()
            else if (
              el.getAttribute("role") === "radiogroup" &&
              option.element.getAttribute("role") === "radio" &&
              entry.elements.includes(option.element) &&
              safeClick(option.element)
            )
              option.element.click()
            else if (
              choice &&
              action.op === "set_single" &&
              option.element instanceof HTMLButtonElement &&
              choice.buttons.includes(option.element) &&
              canClickChoice(option.element)
            )
              option.element.click()
            else if (
              !(option.element instanceof HTMLAnchorElement) &&
              !(
                option.element instanceof HTMLButtonElement &&
                option.element.type !== "button"
              ) &&
              !option.element.querySelector(
                'a[href],button:not([type="button"]),input[type="submit"]'
              ) &&
              optionContainer(entry)?.contains(option.element) &&
              option.element.getAttribute("role") === "option"
            )
              option.element.click()
            else return result("unsupported", "option_unavailable")
          }
        }
      } else return result("unsupported", "operation_unavailable")
      if (
        action.op !== "set_text" ||
        action.format === "iso_date" ||
        action.format === "iso_month"
      ) {
        for (const dependent of this.registry.entries.values()) {
          if (dependent.id === entry.id || !dependent.snapshot.options) continue
          const addressDependency =
            /country/i.test(entry.snapshot.label) &&
            /state|province|city/i.test(dependent.snapshot.label)
          const recordDependency =
            entry.snapshot.groupId &&
            dependent.snapshot.groupId === entry.snapshot.groupId
          if (addressDependency || recordDependency) {
            dependent.invalidatedOptions = dependent.optionFingerprint
            dependent.ready = false
          }
        }
      }
      let stable = 0
      while (Date.now() - started < AUTOFILL_LIMITS.stepMs) {
        await delay(100)
        if (!this.current(plan, false) || entry.edits !== action.userEditEpoch)
          return result("unverified", "interrupted_after_write", "unobservable")
        if (this.matches(entry, action)) {
          stable++
          if (stable >= 4)
            return result(
              "filled",
              action.op === "upload_resume"
                ? "resume_attached"
                : "accepted_value",
              "accepted"
            )
        } else stable = 0
        if (this.invalid(entry))
          return result("failed", "control_rejected", "rejected")
      }
      return result("unverified", "readback_unconfirmed", "unobservable")
    } catch {
      return result("failed", "adapter_failed", "rejected")
    }
  }
  private invalid(entry: Entry) {
    return validationState(entry.element) === "invalid"
  }
  audit(): ActionResult[] {
    if (this.cancelled || !this.sessionId || !this.active())
      throw new Error("audit_unavailable")
    return [...this.successful.values()].map(
      ({ action, entry, result, value }) => {
        const current = this.registry.entries.get(action.fieldId)
        const accepted =
          current?.element === entry.element &&
          current.elements.length === entry.elements.length &&
          current.elements.every(
            (element, index) => element === entry.elements[index]
          ) &&
          fieldFingerprint(
            current.element,
            fieldLabel(current.element, current.group, current.elements),
            current.snapshot.groupId
          ) === entry.fingerprint &&
          committed(current) === value &&
          this.matches(entry, action)
        return accepted
          ? { ...result }
          : {
              ...result,
              status: "unverified",
              reasonCode: "final_readback_changed",
              verification: "unobservable",
              observedFieldRevision: current?.revision ?? 0,
            }
      }
    )
  }
  private matches(entry: Entry, action: FillAction): boolean {
    if (!entry.element.isConnected || this.invalid(entry)) return false
    if (action.op === "upload_resume") {
      const expected = this.uploads.get(action.actionId)
      const files =
        entry.element instanceof HTMLInputElement ? entry.element.files : null
      const actual = files?.[0]
      return Boolean(
        expected &&
          files?.length === 1 &&
          actual &&
          actual.name === expected.name &&
          actual.size === expected.size &&
          actual.type === expected.type &&
          actual.lastModified === expected.lastModified
      )
    }
    if (action.op === "set_text")
      return entry.element instanceof HTMLInputElement ||
        entry.element instanceof HTMLTextAreaElement
        ? entry.element.value === action.value
        : isTextEditor(entry.element) &&
            entry.element.textContent === action.value
    if (action.op === "set_checked")
      return entry.element instanceof HTMLInputElement
        ? entry.element.checked === action.checked
        : ["checkbox", "switch"].includes(
            entry.element.getAttribute("role") ?? ""
          ) &&
            entry.element.getAttribute("aria-checked") ===
              String(action.checked)
    const ids =
      action.op === "set_single" ? [action.optionId] : action.optionIds
    const desired = ids
      .map((id) => entry.options.get(id))
      .filter((o) => o !== undefined)
    if (desired.length !== ids.length) return false
    if (
      buttonChoice(entry.element) ||
      entry.element.getAttribute("role") === "radiogroup" ||
      entry.element instanceof HTMLSelectElement ||
      (entry.element instanceof HTMLInputElement &&
        ["radio", "checkbox"].includes(entry.element.type))
    )
      return (
        JSON.stringify(JSON.parse(committed(entry)).sort()) ===
        JSON.stringify(desired.map((o) => o.value).sort())
      )
    if (entry.element.getAttribute("role") === "listbox")
      return (
        JSON.stringify(JSON.parse(committed(entry)).sort()) ===
        JSON.stringify(desired.map((o) => o.value).sort())
      )
    // Query text is never proof that a combobox committed an option.
    return (
      desired.length === 1 &&
      desired.some(
        (o) =>
          committed(entry) === o.value || committed(entry) === textOf(o.element)
      ) &&
      entry.element.getAttribute("aria-expanded") === "false"
    )
  }
  async addRecord(
    entryRef: string,
    entryRevision: number,
    kind: "experience" | "education"
  ): Promise<{ changed: boolean; reasonCode: string }> {
    const entry = this.registry.recordEntrypoints.get(entryRef)
    if (
      !entry ||
      this.cancelled ||
      !this.sessionId ||
      !this.active() ||
      !this.registry.validStructure() ||
      entry.entryRevision !== entryRevision ||
      entry.kind !== kind ||
      !safeRecordButton(entry.element) ||
      recordEntrypointFingerprint(entry.element, this.registry) !==
        entry.fingerprint
    )
      throw new Error("stale_record_entry")
    const generation = this.generation
    const sessionId = this.sessionId
    const page = location.href
    const reader = new PageReader(this.registry)
    const groupOf = (element: HTMLElement) =>
      closestInPage(element, 'fieldset,[data-autofill-record],[role="group"]')
    const before = new Set(
      reader
        .controls()
        .map(groupOf)
        .filter((group) => group !== null)
    )
    present(entry.element)
    if (
      !safeRecordButton(entry.element) ||
      recordEntrypointFingerprint(entry.element, this.registry) !==
        entry.fingerprint ||
      this.cancelled
    )
      throw new Error("stale_record_entry")
    entry.entryRevision++
    entry.element.click()
    const started = Date.now()
    let stable = 0
    while (Date.now() - started < AUTOFILL_LIMITS.stepMs) {
      await delay(100)
      if (
        this.cancelled ||
        this.generation !== generation ||
        this.sessionId !== sessionId ||
        !this.active() ||
        location.href !== page
      )
        throw new Error("record_entry_interrupted")
      const added = reader.controls().some((element) => {
        const group = groupOf(element)
        if (!group || before.has(group) || !visible(group)) return false
        const label =
          nameOf(group) ||
          group.querySelector("legend,h2,h3")?.textContent ||
          ""
        return kind === "experience"
          ? !/education|school/i.test(label)
          : !/employment|experience|work history/i.test(label)
      })
      stable = added ? stable + 1 : 0
      if (stable >= 4)
        return { changed: true, reasonCode: "record_group_added" }
    }
    return { changed: false, reasonCode: "record_group_unconfirmed" }
  }
  async discover(
    plan: FillPlan,
    request: FillPlan["interactions"][number]
  ): Promise<void> {
    const entry = this.registry.entries.get(request.fieldId)
    if (
      !entry ||
      !this.current(plan) ||
      entry.guard !== request.guardRef ||
      entry.revision !== request.fieldRevision ||
      !visible(entry.element) ||
      !editable(entry.element)
    )
      throw new Error("stale_interaction")
    const started = Date.now()
    const epoch = entry.edits
    const check = () => {
      if (
        !this.current(plan) ||
        Date.now() - started >= AUTOFILL_LIMITS.stepMs ||
        entry.edits !== epoch ||
        !entry.element.isConnected
      )
        throw new Error("interaction_cancelled")
    }
    const el = entry.element
    check()
    if (!safeClick(el)) throw new Error("unsafe_control")
    present(el)
    entry.bindingRef = request.bindingRef
    if (
      el.getAttribute("role") !== "listbox" &&
      el.getAttribute("aria-expanded") !== "true"
    )
      el.click()
    let container = optionContainer(entry)
    const opened = Date.now()
    while (
      !(el instanceof HTMLInputElement) &&
      !container &&
      Date.now() - opened < AUTOFILL_LIMITS.stepMs
    ) {
      await delay(100)
      check()
      container = optionContainer(entry)
    }
    if (!(el instanceof HTMLInputElement)) {
      if (!container) throw new Error("options_unavailable")
      entry.ready = container.getAttribute("aria-busy") !== "true"
      for (let page = 0; page <= request.maxScrollPages; page++) {
        check()
        const observed = readOptions(entry)
        if (
          observed.options.some((o) =>
            request.queries.some(
              (q) =>
                q.trim().toLocaleLowerCase() ===
                o.label.trim().toLocaleLowerCase()
            )
          )
        )
          return
        if (
          page === request.maxScrollPages ||
          container.scrollTop + container.clientHeight >= container.scrollHeight
        )
          return
        const before = observed.options.map((o) => o.optionId).join()
        container.scrollTop += container.clientHeight
        container.dispatchEvent(new Event("scroll", { bubbles: true }))
        let changed = false
        while (!changed) {
          await delay(100)
          check()
          if (container.getAttribute("aria-busy") === "true") continue
          changed =
            readOptions(entry)
              .options.map((o) => o.optionId)
              .join() !== before
        }
      }
      return
    }
    for (const query of request.queries.slice(0, request.maxQueries)) {
      check()
      readOptions(entry)
      const before = entry.optionFingerprint
      entry.queryRevision++
      entry.query = query
      entry.ready = false
      setInput(el, query)
      const start = Date.now()
      let observedLoading = false
      let stable = 0
      let fingerprint = ""
      while (Date.now() - start < AUTOFILL_LIMITS.stepMs) {
        await delay(100)
        check()
        if (el.value !== query) throw new Error("query_changed")
        container = optionContainer(entry)
        if (!container) continue
        const busy =
          container.getAttribute("aria-busy") ?? el.getAttribute("aria-busy")
        if (busy === "true") observedLoading = true
        const options = readOptions(entry)
        const attributed =
          !container.hasAttribute("data-query") ||
          container.getAttribute("data-query") === query
        const evidence =
          entry.optionFingerprint !== before ||
          observedLoading ||
          options.options.some(
            (option) =>
              option.label.trim().toLocaleLowerCase() ===
              query.trim().toLocaleLowerCase()
          )
        const settled =
          busy !== "true" &&
          attributed &&
          evidence &&
          entry.optionFingerprint === fingerprint
        stable = settled ? stable + 1 : 0
        fingerprint = entry.optionFingerprint
        if (stable >= 3) {
          entry.ready = true
          if (options.options.length) return
          break
        }
      }
      if (!entry.ready) throw new Error("query_results_unattributed")
    }
  }
}
