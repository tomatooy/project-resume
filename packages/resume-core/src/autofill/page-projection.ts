import type { PageNode, PageView } from "./page-contract"

export function projectPageView(
  pageView: PageView,
  fieldIds: string[]
): PageView {
  const selected = new Set(fieldIds)
  const nodes = new Map(pageView.nodes.map((node) => [node.ref, node]))
  const retained = new Set<string>()
  const visited = new Set<string>()
  const pending: string[] = []
  function retain(ref: string): void {
    if (visited.has(ref)) return
    visited.add(ref)
    const node = nodes.get(ref)
    if (!node) return
    if (!node.fieldId || selected.has(node.fieldId)) {
      retained.add(ref)
      pending.push(ref)
    }
    if (node.parentRef) retain(node.parentRef)
  }
  const fieldNodes = pageView.nodes.filter(
    (node) => node.fieldId && selected.has(node.fieldId)
  )
  for (const node of fieldNodes) retain(node.ref)
  const parents = new Set(retained)
  const immediateParents = new Set(fieldNodes.map((node) => node.parentRef))
  for (const node of pageView.nodes) {
    if (
      !node.fieldId &&
      node.text &&
      node.parentRef &&
      (immediateParents.has(node.parentRef) ||
        (/^(h[1-6]|legend)$/.test(node.tag) && parents.has(node.parentRef)))
    )
      retain(node.ref)
  }
  while (pending.length) {
    const ref = pending.pop()
    const node = ref ? nodes.get(ref) : undefined
    if (!node) continue
    for (const relation of node.relations) retain(relation.ref)
  }
  function retainedParent(node: PageNode): string | undefined {
    const seen = new Set<string>([node.ref])
    let parentRef = node.parentRef
    while (parentRef && !seen.has(parentRef)) {
      if (retained.has(parentRef)) return parentRef
      seen.add(parentRef)
      parentRef = nodes.get(parentRef)?.parentRef
    }
    return undefined
  }
  const projectedNodes = pageView.nodes
    .filter((node) => retained.has(node.ref))
    .map((node) => ({
      ...node,
      parentRef: retainedParent(node),
      relations: node.relations.filter((relation) =>
        retained.has(relation.ref)
      ),
    }))
  const rootIds = new Set(projectedNodes.map((node) => node.rootId))
  const omittedFields = pageView.nodes.some(
    (node) => node.fieldId && !selected.has(node.fieldId)
  )
  return {
    ...pageView,
    roots: pageView.roots.filter((root) => rootIds.has(root.rootId)),
    nodes: projectedNodes,
    coverage: {
      ...pageView.coverage,
      complete: pageView.coverage.complete && !omittedFields,
    },
  }
}
