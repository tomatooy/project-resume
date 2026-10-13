import {
  FormSnapshotSchema,
  type FieldSnapshot,
  type ContextRead,
} from "@workspace/resume-core/contracts"
import type { Observation } from "./messages"
import { buttonChoice } from "./button-choice"
import { PageReader } from "./page-reader"
import {
  closestInPage,
  contextText,
  isTextEditor,
  pageElements,
  referenced,
} from "./dom"
import {
  type Registry,
  committed,
  commitState,
  emptyValue,
  nameOf,
  readOptions,
  visible,
  editable,
  validationState,
} from "./registry"

export const elements = pageElements
export function fieldFingerprint(
  el: HTMLElement,
  label: string,
  groupId?: string
): string {
  return JSON.stringify([
    el.tagName,
    el.getAttribute("type"),
    el.getAttribute("name"),
    el.getAttribute("role"),
    el.getAttribute("placeholder"),
    el.getAttribute("autocomplete"),
    el.getAttribute("inputmode"),
    label,
    groupId,
    el.getAttribute("aria-describedby"),
    referenced(el, "aria-describedby").map(contextText),
    el.getAttribute("required"),
    el.getAttribute("aria-required"),
    el.getAttribute("aria-readonly"),
    el.getAttribute("contenteditable"),
    el.getAttribute("maxlength"),
    el.getAttribute("pattern"),
    el.getAttribute("min"),
    el.getAttribute("max"),
    el.getAttribute("accept"),
    el.hasAttribute("multiple"),
    buttonChoice(el)?.input.name,
  ])
}

export function fieldLabel(
  element: HTMLElement,
  group: HTMLElement | null,
  peers: HTMLElement[]
): string {
  const grouped =
    element instanceof HTMLInputElement &&
    (element.type === "radio" ||
      (element.type === "checkbox" && peers.length > 1))
  return grouped && group
    ? nameOf(group) ||
        group.querySelector("legend,h2,h3")?.textContent?.trim() ||
        ""
    : nameOf(element)
}

export class Scanner {
  private readonly reader: PageReader
  constructor(readonly registry: Registry) {
    this.reader = new PageReader(registry)
  }
  observe(formId?: string, contextRequests: ContextRead[] = []): Observation {
    const { doc } = this.registry
    const read = this.reader.read(contextRequests)
    const regions = elements(
      doc,
      'form,[role="form"],[role="dialog"],[role="tabpanel"]'
    ).filter(visible)
    const root = doc.body
    const available = [root, ...regions]
    const forms = available.slice(0, 200).map((element) => ({
      id: this.registry.idFor(element),
      label: (element === root
        ? "Current page"
        : nameOf(element) ||
          element.querySelector("h1,h2,h3,legend")?.textContent?.trim() ||
          "Form region"
      ).slice(0, 1000),
      fields: read.controls.filter(
        (control) =>
          element === root ||
          element.contains(control) ||
          (control.getRootNode() instanceof ShadowRoot &&
            closestInPage(
              control,
              "form,[role=form],[role=dialog],[role=tabpanel]"
            ) === element)
      ).length,
    }))
    const selected =
      available.find((element) => this.registry.idFor(element) === formId) ??
      root
    const selectedId = this.registry.idFor(selected)
    const raw = read.controls.filter(
      (element) =>
        selected === root ||
        selected.contains(element) ||
        closestInPage(
          element,
          "form,[role=form],[role=dialog],[role=tabpanel]"
        ) === selected
    )
    this.registry.form = selected
    this.registry.formId = selectedId
    const pagePath = doc.location.pathname
    const selectedLabel = selected === root ? "" : nameOf(selected)
    this.registry.validStructure = () => {
      if (
        doc.location.pathname !== pagePath ||
        !selected.isConnected ||
        (selected !== root && nameOf(selected) !== selectedLabel)
      )
        return false
      const current = this.reader
        .controls()
        .filter(
          (element) =>
            selected === root ||
            selected.contains(element) ||
            closestInPage(
              element,
              "form,[role=form],[role=dialog],[role=tabpanel]"
            ) === selected
        )
      return (
        current.length === raw.length &&
        current.every((element, index) => element === raw[index])
      )
    }
    const fields: FieldSnapshot[] = []
    const seen = new Set<HTMLElement>()
    const groups = new Map<
      string,
      {
        groupId: string
        label: string
        kind: "experience" | "education" | "other"
      }
    >()
    for (const element of raw) {
      if (seen.has(element) || fields.length >= 200) continue
      const group = closestInPage(
        element,
        'fieldset,[data-autofill-record],[role="group"],[role="radiogroup"]'
      )
      const section = group
        ? nameOf(group) ||
          group.querySelector("legend,h2,h3")?.textContent?.trim() ||
          ""
        : ""
      const groupId = group ? this.registry.idFor(group) : undefined
      if (groupId)
        groups.set(groupId, {
          groupId,
          label: section.slice(0, 1000),
          kind: /education/i.test(section)
            ? "education"
            : /employment|experience|work history/i.test(section)
              ? "experience"
              : "other",
        })
      const grouped =
        element instanceof HTMLInputElement &&
        (element.type === "radio" ||
          (element.type === "checkbox" && Boolean(group)))
      const peers =
        element.getAttribute("role") === "radiogroup"
          ? elements(element, '[role="radio"]').filter(visible)
          : grouped
            ? raw.filter(
                (peer) =>
                  peer instanceof HTMLInputElement &&
                  peer.type === element.type &&
                  (element.type === "radio"
                    ? Boolean(element.name) &&
                      peer.name === element.name &&
                      peer.form === element.form &&
                      peer.getRootNode() === element.getRootNode()
                    : true) &&
                  closestInPage(
                    peer,
                    'fieldset,[data-autofill-record],[role="group"]'
                  ) === group
              )
            : [element]
      for (const peer of peers) seen.add(peer)
      seen.add(element)
      const fullLabel = fieldLabel(element, group, peers)
      const description = referenced(element, "aria-describedby")
        .map(contextText)
        .join(" ")
        .trim()
      const choice = buttonChoice(element)
      const role = element.getAttribute("role")
      const custom = ["combobox", "listbox"].includes(role ?? "")
      const kind: FieldSnapshot["control"] =
        choice || role === "radiogroup"
          ? "radio_group"
          : custom
            ? element.getAttribute("aria-multiselectable") === "true"
              ? "multi_select"
              : "single_select"
            : ["checkbox", "switch"].includes(role ?? "")
              ? "checkbox"
              : element instanceof HTMLSelectElement
                ? element.multiple
                  ? "multi_select"
                  : "single_select"
                : element instanceof HTMLTextAreaElement ||
                    isTextEditor(element)
                  ? "textarea"
                  : element instanceof HTMLInputElement
                    ? element.type === "radio"
                      ? "radio_group"
                      : element.type === "checkbox"
                        ? peers.length > 1
                          ? "checkbox_group"
                          : "checkbox"
                        : element.type === "file"
                          ? "file"
                          : element.type === "date"
                            ? "date"
                            : element.type === "month"
                              ? "month"
                              : [
                                    "text",
                                    "email",
                                    "tel",
                                    "url",
                                    "number",
                                    "search",
                                  ].includes(element.type)
                                ? "text"
                                : "unsupported"
                    : "unsupported"
      const id = this.registry.idFor(element)
      const prior = this.registry.entries.get(id)
      const fingerprint =
        !prior?.dirty &&
        prior?.snapshot.label === fullLabel &&
        prior.snapshot.groupId === groupId
          ? prior.fingerprint
          : fieldFingerprint(element, fullLabel, groupId)
      const value = committed({ element, elements: peers })
      const known = commitState({ element, elements: peers }) === "known"
      const changed =
        !prior ||
        prior.fingerprint !== fingerprint ||
        prior.elements.length !== peers.length ||
        prior.elements.some((peer, index) => peers[index] !== peer)
      const guard =
        changed || prior?.before !== value || prior.commitKnown !== known
          ? crypto.randomUUID()
          : prior.guard
      const hasQuery =
        custom &&
        element instanceof HTMLInputElement &&
        Boolean(element.value) &&
        element.value !== prior?.query
      const snapshot: FieldSnapshot = {
        fieldId: id,
        fieldRevision: (prior?.revision ?? 0) + (changed ? 1 : 0),
        control: kind,
        label: fullLabel.slice(0, 1000),
        description: description.slice(0, 2000),
        section: section.slice(0, 1000),
        groupId,
        attributes: {
          type: element.getAttribute("type")?.slice(0, 100),
          name: element.getAttribute("name")?.slice(0, 200),
          autocomplete: element.getAttribute("autocomplete")?.slice(0, 200),
          placeholder: element.getAttribute("placeholder")?.slice(0, 500),
          inputmode: element.getAttribute("inputmode")?.slice(0, 100),
          accept: element.getAttribute("accept")?.slice(0, 500),
        },
        constraints: {
          required:
            element.hasAttribute("required") ||
            element.getAttribute("aria-required") === "true",
          maxLength:
            (element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement) &&
            element.maxLength >= 0
              ? element.maxLength
              : undefined,
          pattern: element.getAttribute("pattern")?.slice(0, 500),
          min: element.getAttribute("min")?.slice(0, 100),
          max: element.getAttribute("max")?.slice(0, 100),
        },
        state: {
          visible: true,
          editable: editable(element),
          empty: known && emptyValue(value) && !hasQuery,
          hasUserValue:
            !known || !emptyValue(value) || hasQuery || Boolean(prior?.edits),
          commitState: known ? "known" : "unknown",
          validationState: validationState(element),
          truncated:
            fullLabel.length > 1000 ||
            description.length > 2000 ||
            section.length > 1000,
        },
        userEditEpoch: prior?.edits ?? 0,
        guardRef: guard,
        capabilities: {
          adapterId: choice
            ? "button-choice-v1"
            : custom
              ? "aria-combobox-v1"
              : "native-v1",
          read: true,
          write: kind !== "unsupported",
          verify: known,
          discover: custom,
          search: custom && element instanceof HTMLInputElement,
          scroll: custom,
        },
      }
      const entry = {
        id,
        element,
        elements: peers,
        revision: snapshot.fieldRevision,
        fingerprint,
        guard,
        before: value,
        commitKnown: known,
        edits: prior?.edits ?? 0,
        snapshot,
        group,
        bindingRef: prior?.bindingRef,
        optionRevision: prior?.optionRevision ?? 0,
        optionFingerprint: prior?.optionFingerprint ?? "",
        options: prior?.options ?? new Map(),
        queryRevision: prior?.queryRevision ?? 0,
        query: prior?.query ?? "",
        ready: prior?.ready ?? false,
        dirty: false,
        invalidatedOptions: prior?.invalidatedOptions,
      }
      if (
        [
          "single_select",
          "multi_select",
          "radio_group",
          "checkbox_group",
        ].includes(kind)
      )
        snapshot.options = readOptions(entry)
      this.registry.entries.set(id, entry)
      fields.push(snapshot)
    }
    const currentIds = new Set(fields.map((field) => field.fieldId))
    for (const [id, entry] of this.registry.entries)
      if (!entry.element.isConnected || !currentIds.has(id))
        this.registry.entries.delete(id)
    this.registry.reviseStructure(
      JSON.stringify([
        selectedId,
        fields.map((field) => [field.fieldId, field.fieldRevision]),
      ])
    )
    const uncovered = read.unobservedFrames > 0 || read.opaque
    const truncated =
      read.truncated || raw.length > 200 || available.length > 200
    const fieldIds = new Set(fields.map((field) => field.fieldId))
    for (const node of read.view.nodes)
      if (node.fieldId && !fieldIds.has(node.fieldId)) node.fieldId = undefined
    const label =
      selected !== root
        ? nameOf(selected)
        : regions.length === 1
          ? nameOf(regions[0] ?? root)
          : ""
    return {
      forms,
      uncovered,
      recordEntrypoints: [...this.registry.recordEntrypoints.values()]
        .slice(0, 50)
        .map(({ entryRef, entryRevision, kind, label }) => ({
          entryRef,
          entryRevision,
          kind,
          label,
        })),
      snapshot: FormSnapshotSchema.parse({
        schemaVersion: 1,
        snapshotId: read.view.snapshotId,
        documentEpoch: this.registry.documentEpoch,
        formRevision: this.registry.formRevision,
        formId: selectedId,
        formLabel: (label || doc.title || "Current page").slice(0, 1000),
        fields,
        groups: [...groups.values()],
        pageView: read.view,
        coverage: truncated || uncovered ? "partial" : "complete",
        coverageReasons: [
          ...(truncated ? ["truncated"] : []),
          ...(read.unobservedFrames ? ["inaccessible_frame"] : []),
          ...(read.opaque ? ["unsupported"] : []),
        ],
        observedAt: new Date().toISOString(),
      }),
    }
  }
}
