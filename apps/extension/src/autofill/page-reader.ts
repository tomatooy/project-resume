import {
  PAGE_VIEW_LIMITS,
  type ContextRead,
  type PageView,
} from "@workspace/resume-core/contracts"
import { buttonChoice, canClickChoice } from "./button-choice"
import {
  closestInPage,
  contextText,
  isTextEditor,
  pageElements,
  parentOf,
  referenced,
  valueContentSelector,
  type PageRoot,
} from "./dom"
import {
  availableControl,
  editable,
  nameOf,
  visible,
  type Registry,
  type RecordEntrypoint,
} from "./registry"

const controlSelector =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[role="listbox"],[role="radiogroup"],[role="radio"],[role="checkbox"],[role="switch"]'

export function recordEntrypointFingerprint(
  button: HTMLButtonElement,
  registry: Registry
): string {
  return JSON.stringify([
    nameOf(button) || contextText(button),
    button.type,
    button.form?.id,
    button.parentElement ? registry.idFor(button.parentElement) : null,
    button.disabled,
    button.getAttribute("aria-disabled"),
    button.getAttribute("popovertarget"),
    button.getAttribute("commandfor"),
  ])
}

export function safeRecordButton(button: HTMLButtonElement): boolean {
  return (
    button.type === "button" &&
    canClickChoice(button) &&
    editable(button) &&
    visible(button) &&
    !button.hasAttribute("formaction") &&
    !button.querySelector("a[href],input,select,textarea")
  )
}

export class PageReader {
  constructor(private readonly registry: Registry) {}

  controls(): HTMLElement[] {
    const all = pageElements(this.registry.doc)
    const roots: PageRoot[] = [
      this.registry.doc,
      ...all.flatMap((element) =>
        element.shadowRoot ? [element.shadowRoot] : []
      ),
    ].slice(0, PAGE_VIEW_LIMITS.roots)
    return collectControls(all)
      .filter((element) => {
        const root = element.getRootNode()
        return roots.includes(
          root instanceof ShadowRoot ? root : this.registry.doc
        )
      })
      .slice(0, 200)
  }

  read(contextRequests: ContextRead[] = []) {
    const { doc } = this.registry
    this.registry.flushMutations()
    const all = pageElements(doc)
    const roots: PageRoot[] = [doc]
    for (const element of all)
      if (element.shadowRoot) {
        roots.push(element.shadowRoot)
        this.registry.observeRoot(element.shadowRoot)
      }
    const candidates = collectControls(all)
    const activeRoots = roots.slice(0, PAGE_VIEW_LIMITS.roots)
    const ownRoot = (element: HTMLElement): PageRoot => {
      const root = element.getRootNode()
      return root instanceof ShadowRoot ? root : doc
    }
    const controls = candidates
      .filter((element) => activeRoots.includes(ownRoot(element)))
      .slice(0, 200)
    const fields = controls
    const buttons = all.filter(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && visible(element)
    )
    this.readEntrypoints(buttons)
    const rootId = (root: Node): string =>
      root instanceof ShadowRoot
        ? `shadow_${this.registry.idFor(root.host instanceof HTMLElement ? root.host : doc.documentElement)}`
        : "document"
    const fieldSet = new Set(fields)
    const semanticReferences = new Set(
      fields.flatMap((field) =>
        referenced(field, "aria-labelledby").concat(
          referenced(field, "aria-describedby")
        )
      )
    )
    const included = new Set<HTMLElement>(fields)
    for (const request of contextRequests.slice(0, 8)) {
      if (!this.registry.publishedRefs.has(request.fieldId)) continue
      const element = this.registry.nodes.get(request.fieldId)
      if (!element?.isConnected) continue
      const related: HTMLElement[] = []
      if (request.relation === "ancestors") {
        let parent = parentOf(element)
        while (parent instanceof HTMLElement && related.length < 10) {
          related.push(
            parent,
            ...pageElements(parent, "h1,h2,h3,h4,legend,label").slice(0, 10)
          )
          parent = parentOf(parent)
        }
      } else if (request.relation === "siblings") {
        const parent = parentOf(element)
        if (parent instanceof HTMLElement)
          related.push(parent, ...pageElements(parent).slice(0, 80))
      } else if (request.relation === "description") {
        related.push(
          ...referenced(element, "aria-describedby"),
          ...referenced(element, "aria-labelledby")
        )
      } else {
        for (const container of referenced(element, "aria-controls").concat(
          referenced(element, "aria-owns")
        ))
          related.push(
            container,
            ...pageElements(container, '[role="option"]').slice(0, 80)
          )
      }
      for (const node of related.slice(0, 80)) included.add(node)
    }
    for (const field of fields) {
      let parent = parentOf(field)
      while (parent instanceof HTMLElement && parent !== doc.documentElement) {
        included.add(parent)
        parent = parentOf(parent)
      }
      for (const attribute of [
        "aria-labelledby",
        "aria-describedby",
        "aria-controls",
        "aria-owns",
      ])
        for (const related of referenced(field, attribute))
          included.add(related)
      const choice = buttonChoice(field)
      if (choice) included.add(choice.label)
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      ) {
        for (const label of field.labels ?? []) included.add(label)
        if (field.form) included.add(field.form)
      }
    }
    for (const element of all)
      if (element.matches("h1,h2,h3,h4,h5,h6,legend,label") && visible(element))
        included.add(element)
    for (const element of all)
      if (
        visible(element) &&
        (element.matches("button,[role=button],[role=option]") ||
          [...element.childNodes].some(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
          ))
      )
        included.add(element)
    for (const element of [...included]) {
      let parent = element.parentElement
      while (parent && parent !== doc.documentElement) {
        included.add(parent)
        parent = parent.parentElement
      }
    }
    const selected = [...included]
      .filter((element) => activeRoots.includes(ownRoot(element)))
      .slice(0, PAGE_VIEW_LIMITS.nodes - activeRoots.length)
    let truncated =
      candidates.length > fields.length ||
      included.size > selected.length ||
      roots.length > activeRoots.length ||
      this.registry.recordEntrypoints.size > 50
    const refs = new Set(
      selected.map((element) => this.registry.idFor(element))
    )
    const nodes: PageView["nodes"] = selected.map((element) => {
      const relations: PageView["nodes"][number]["relations"] = []
      const add = (
        kind: PageView["nodes"][number]["relations"][number]["kind"],
        related: HTMLElement
      ) => {
        const ref = this.registry.idFor(related)
        if (
          refs.has(ref) &&
          relations.length < 40 &&
          !relations.some(
            (relation) => relation.kind === kind && relation.ref === ref
          )
        )
          relations.push({ kind, ref })
      }
      for (const [attribute, kind] of [
        ["aria-labelledby", "label"],
        ["aria-describedby", "description"],
        ["aria-controls", "controls"],
        ["aria-owns", "owns"],
      ] satisfies [
        string,
        PageView["nodes"][number]["relations"][number]["kind"],
      ][])
        for (const related of referenced(element, attribute)) add(kind, related)
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        for (const label of element.labels ?? []) add("label", label)
        if (element.form) add("form", element.form)
      }
      if (element.assignedSlot) add("slot", element.assignedSlot)
      const choice = buttonChoice(element)
      if (choice) add("label", choice.label)
      const parent = element.parentElement
      const parentRef =
        parent instanceof HTMLElement ? this.registry.idFor(parent) : undefined
      const valueContainer = closestInPage(element, valueContentSelector)
      const rawText = fieldSet.has(element)
        ? nameOf(element)
        : valueContainer || isTextEditor(element)
          ? ""
          : element.matches(
                "label,legend,h1,h2,h3,h4,h5,h6,button,[role=option]"
              ) || semanticReferences.has(element)
            ? contextText(element)
            : [...element.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent ?? "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
      if (rawText.length > 2000) truncated = true
      return {
        ref: this.registry.idFor(element),
        rootId: rootId(element.getRootNode()),
        parentRef:
          parentRef &&
          refs.has(parentRef) &&
          parent?.getRootNode() === element.getRootNode()
            ? parentRef
            : rootId(element.getRootNode()),
        tag: element.localName.slice(0, 80),
        role: element.getAttribute("role")?.slice(0, 100),
        text: rawText.slice(0, 2000),
        fieldId: fieldSet.has(element)
          ? this.registry.idFor(element)
          : undefined,
        relations,
      }
    })
    nodes.push(
      ...activeRoots.map((root) => ({
        ref: rootId(root),
        rootId: rootId(root),
        tag: root instanceof ShadowRoot ? "#shadow-root" : "#document",
        text: "",
        relations: [],
      }))
    )
    const unobservedFrames = all.filter(
      (element) => element instanceof HTMLIFrameElement
    ).length
    const opaque = all.some(
      (element) =>
        element.localName.includes("-") &&
        !element.shadowRoot &&
        !element.childElementCount &&
        visible(element)
    )
    const view: PageView = {
      snapshotId: crypto.randomUUID(),
      documentEpoch: this.registry.documentEpoch,
      roots: activeRoots.map((root) => ({
        rootId: rootId(root),
        kind: root instanceof ShadowRoot ? "shadow" : "document",
      })),
      nodes,
      coverage: {
        complete: !truncated && !unobservedFrames && !opaque,
        truncated,
        unobservedFrames,
      },
    }
    const bytes = () =>
      new TextEncoder().encode(JSON.stringify(view)).byteLength
    if (bytes() > PAGE_VIEW_LIMITS.bytes) {
      truncated = true
      for (const length of [120, 40, 0]) {
        for (const node of nodes) node.text = node.text.slice(0, length)
        if (bytes() <= PAGE_VIEW_LIMITS.bytes) break
      }
      while (bytes() > PAGE_VIEW_LIMITS.bytes) {
        let index = nodes.length - 1
        while (
          index >= 0 &&
          (nodes[index]?.fieldId || nodes[index]?.ref === nodes[index]?.rootId)
        )
          index--
        if (index < 0) break
        const removed = nodes.splice(index, 1)[0]
        for (const node of nodes) {
          if (node.parentRef === removed?.ref)
            node.parentRef = removed?.parentRef ?? node.rootId
          node.relations = node.relations.filter(
            (relation) => relation.ref !== removed?.ref
          )
        }
      }
      if (bytes() > PAGE_VIEW_LIMITS.bytes)
        for (const node of nodes) {
          node.relations = []
          node.role = undefined
          if (node.ref !== node.rootId) node.parentRef = node.rootId
        }
      view.coverage.truncated = true
      view.coverage.complete = false
    }
    this.registry.publishedRefs.clear()
    for (const node of nodes) this.registry.publishedRefs.add(node.ref)
    for (const [ref, element] of this.registry.nodes)
      if (!element.isConnected) this.registry.nodes.delete(ref)
    return {
      controls,
      buttons,
      roots: activeRoots,
      view,
      truncated,
      unobservedFrames,
      opaque,
    }
  }

  private readEntrypoints(buttons: HTMLButtonElement[]) {
    const current = new Set<string>()
    for (const button of buttons) {
      if (!safeRecordButton(button)) continue
      const label = nameOf(button) || contextText(button)
      const match =
        /^(?:add(?:\s+(?:another|a|an|more))?|\+)\s+(?:(?:work|employment)\s+)?(experience|employment|job|position|education|school|qualification)(?:\s+(?:entry|record))?$/i.exec(
          label.trim()
        )
      if (!match?.[1]) continue
      const entryRef = this.registry.idFor(button)
      const kind: RecordEntrypoint["kind"] =
        /education|school|qualification/i.test(match[1])
          ? "education"
          : "experience"
      const fingerprint = recordEntrypointFingerprint(button, this.registry)
      const previous = this.registry.recordEntrypoints.get(entryRef)
      this.registry.recordEntrypoints.set(entryRef, {
        entryRef,
        entryRevision:
          (previous?.entryRevision ?? 0) +
          (previous?.fingerprint === fingerprint ? 0 : 1),
        kind,
        label: label.slice(0, 1000),
        element: button,
        fingerprint,
      })
      current.add(entryRef)
    }
    for (const ref of this.registry.recordEntrypoints.keys())
      if (!current.has(ref)) this.registry.recordEntrypoints.delete(ref)
  }
}

function collectControls(all: HTMLElement[]): HTMLElement[] {
  const combinations = all.filter(
    (element) => element.getAttribute("role") === "combobox"
  )
  const owned = new Set(
    combinations.flatMap((element) =>
      referenced(element, "aria-controls").concat(
        referenced(element, "aria-owns")
      )
    )
  )
  const candidates = new Set<HTMLElement>()
  for (const element of all) {
    const choice = element.parentElement
      ? buttonChoice(element.parentElement)
      : null
    if (choice) {
      if (
        element instanceof HTMLButtonElement &&
        element.parentElement &&
        visible(element.parentElement)
      )
        candidates.add(element.parentElement)
      continue
    }
    if (!element.matches(controlSelector) || !availableControl(element))
      continue
    if (
      element instanceof HTMLInputElement &&
      ["hidden", "password", "submit", "reset", "button"].includes(element.type)
    )
      continue
    if (closestInPage(element, '[role="option"]')) continue
    if (element.getAttribute("role") === "listbox" && owned.has(element))
      continue
    const parent = parentOf(element)
    if (
      parent &&
      closestInPage(
        parent,
        '[role="radiogroup"],[role="combobox"],[contenteditable]:not([contenteditable="false"])'
      )
    )
      continue
    candidates.add(element)
  }
  return [...candidates]
}
