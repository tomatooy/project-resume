import { z } from "zod"

/**
 * The two protocol payloads this reader consumes, validated at the boundary.
 *
 * The DevTools Protocol is external input: a domain may omit `children`, report
 * a node without `backendNodeId`, or drop `properties` entirely. Parsing it here
 * means a surface-shape surprise degrades into an explicit coverage gap instead
 * of a crash halfway through a page.
 */

const AxValueSchema = z.looseObject({
  type: z.string().optional(),
  value: z.unknown().optional(),
})

const AxPropertySchema = z.looseObject({
  name: z.string(),
  value: AxValueSchema.optional(),
})

export const AxNodeSchema = z.looseObject({
  nodeId: z.string(),
  ignored: z.boolean().optional(),
  role: AxValueSchema.optional(),
  name: AxValueSchema.optional(),
  description: AxValueSchema.optional(),
  value: AxValueSchema.optional(),
  properties: z.array(AxPropertySchema).optional(),
  childIds: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  /**
   * The join key with the DOM tree. Absent for ignored and synthetic nodes,
   * which is why an AX omission never erases a DOM-observed control.
   */
  backendDOMNodeId: z.number().optional(),
})

export type AxNode = z.infer<typeof AxNodeSchema>
export type AxProperty = z.infer<typeof AxPropertySchema>

export type DomNode = {
  nodeId?: number
  backendNodeId?: number
  nodeType: number
  nodeName: string
  nodeValue?: string
  attributes?: string[]
  childNodeCount?: number
  children?: DomNode[]
  shadowRoots?: DomNode[]
  shadowRootType?: string
  contentDocument?: DomNode
  frameId?: string
  pseudoType?: string
}

/**
 * Recursive, so the schema carries an explicit output annotation: nothing else
 * can name the type a `z.lazy` resolves to.
 */
export const DomNodeSchema: z.ZodType<DomNode> = z.lazy(() =>
  z.looseObject({
    nodeId: z.number().optional(),
    backendNodeId: z.number().optional(),
    nodeType: z.number(),
    nodeName: z.string(),
    nodeValue: z.string().optional(),
    attributes: z.array(z.string()).optional(),
    childNodeCount: z.number().optional(),
    children: z.array(DomNodeSchema).optional(),
    shadowRoots: z.array(DomNodeSchema).optional(),
    shadowRootType: z.string().optional(),
    contentDocument: DomNodeSchema.optional(),
    frameId: z.string().optional(),
    pseudoType: z.string().optional(),
  })
)

export const DomDocumentSchema = z.looseObject({ root: DomNodeSchema })
export const DomNodeResultSchema = z.looseObject({
  node: DomNodeSchema.optional(),
})
export const AxTreeSchema = z.looseObject({ nodes: z.array(AxNodeSchema) })

export type DomDocument = z.infer<typeof DomDocumentSchema>

/** An AX value as text. Non-string values carry no wording, so they drop out. */
export function axText(
  value: z.infer<typeof AxValueSchema> | undefined
): string {
  if (!value) return ""
  if (typeof value.value === "string") return value.value
  if (typeof value.value === "number" || typeof value.value === "boolean")
    return String(value.value)
  return ""
}

export function axProperty(node: AxNode, name: string): AxProperty | undefined {
  return node.properties?.find((property) => property.name === name)
}

/**
 * A tri-state AX boolean. `null` means the protocol did not say, which is not
 * the same as false.
 */
export function axBoolean(node: AxNode, name: string): boolean | null {
  const property = axProperty(node, name)
  const value = property?.value?.value
  if (value === true || value === "true") return true
  if (value === false || value === "false") return false
  return null
}

/** `attributes` arrives as a flat name/value list, which is easy to misread. */
export function attributeMap(node: DomNode): Map<string, string> {
  const map = new Map<string, string>()
  const attributes = node.attributes
  if (!attributes) return map
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    const name = attributes[index]
    const value = attributes[index + 1]
    if (name !== undefined && value !== undefined) map.set(name, value)
  }
  return map
}
