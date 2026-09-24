import { z } from "zod"

export const ResumeViewSchema = z.enum([
  "editor",
  "versions",
  "export",
  "interview",
])

export const TabTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("resume"),
    resumeId: z.string().min(1),
    view: ResumeViewSchema,
  }),
  z.object({ kind: z.literal("skills") }),
  z.object({ kind: z.literal("skill"), skillId: z.string().min(1) }),
])
export type TabTarget = z.infer<typeof TabTargetSchema>

export const WorkspaceSnapshotSchema = z.object({
  version: z.literal(1),
  tabs: z.array(TabTargetSchema),
  lastActiveKey: z.string().nullable(),
})
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>

export function tabKey(target: TabTarget): string {
  switch (target.kind) {
    case "resume":
      return `resume:${target.resumeId}:${target.view}`
    case "skills":
      return "skills"
    case "skill":
      return `skill:${target.skillId}`
  }
}

export function routeTarget(pathname: string): TabTarget | null {
  try {
    return decodedRouteTarget(pathname)
  } catch {
    return null
  }
}

function decodedRouteTarget(pathname: string): TabTarget | null {
  const parts = pathname.replace(/\/$/, "").split("/")
  if (parts[1] === "skills" && parts.length <= 3) {
    return parts[2]
      ? { kind: "skill", skillId: decodeURIComponent(parts[2]) }
      : { kind: "skills" }
  }
  if (parts[1] !== "r" || !parts[2] || parts.length !== 4) return null
  const view = ResumeViewSchema.safeParse(
    parts[3] === "edit" ? "editor" : parts[3]
  )
  return view.success
    ? {
        kind: "resume",
        resumeId: decodeURIComponent(parts[2]),
        view: view.data,
      }
    : null
}

export function tabRoute(target: TabTarget | null) {
  if (!target) return { to: "/dashboard" } as const
  if (target.kind === "skills") return { to: "/skills" } as const
  if (target.kind === "skill")
    return {
      to: "/skills/$skillId",
      params: { skillId: target.skillId },
    } as const
  const params = { resumeId: target.resumeId }
  switch (target.view) {
    case "editor":
      return { to: "/r/$resumeId/edit", params } as const
    case "versions":
      return { to: "/r/$resumeId/versions", params } as const
    case "export":
      return { to: "/r/$resumeId/export", params } as const
    case "interview":
      return { to: "/r/$resumeId/interview", params } as const
  }
}

export function uniqueTabs(tabs: TabTarget[]): TabTarget[] {
  return [...new Map(tabs.map((tab) => [tabKey(tab), tab])).values()]
}
