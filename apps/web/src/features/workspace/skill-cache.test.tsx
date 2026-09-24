import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { render, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import type * as api from "@/lib/api"
import { saveWorkspaceSkill, userSkillQuery } from "@/lib/queries"
import { Workspace } from "./store"
import { tabKey, type TabTarget } from "./targets"

const server = vi.hoisted(() => ({
  listSkills: vi.fn<typeof api.listSkills>(),
  getUserSkill: vi.fn<typeof api.getUserSkill>(),
  updateUserSkill: vi.fn<typeof api.updateUserSkill>(),
}))
vi.mock("@/lib/api", () => server)

it("reopens saved skill contents after saving and closing a background tab", async () => {
  const initial: Awaited<ReturnType<typeof api.getUserSkill>> = {
    id: "usr_test",
    category: "editor",
    name: "Original",
    description: "Description",
    body: "Original body",
    createdAt: "2026-01-01T00:00:00Z",
  }
  const saved = { ...initial, body: "Saved body" }
  server.updateUserSkill.mockResolvedValue(saved)
  server.getUserSkill.mockResolvedValue(saved)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  let active: TabTarget | null = { kind: "skill", skillId: initial.id }
  const onError = vi.fn()
  const workspace = new Workspace("user", {
    navigate: async (target) => {
      active = target
    },
    active: () => active,
    confirm: async () => "save",
    onError,
    saveSkill: (fields, id) => saveWorkspaceSkill(client, fields, id),
    resumeChanged: () => undefined,
    releaseResume: async () => undefined,
  })
  workspace.hydrate(null, false)
  client.setQueryData(userSkillQuery(initial.id).queryKey, initial)
  const editor = workspace.ensureSkill(initial.id, initial)
  editor.set("body", saved.body)
  await workspace.openTab({ kind: "skills" })
  expect(
    await workspace.requestCloseTabs([
      tabKey({ kind: "skill", skillId: initial.id }),
    ])
  ).toBe(true)
  expect(onError).not.toHaveBeenCalled()
  expect(server.updateUserSkill).toHaveBeenCalledWith(
    expect.objectContaining({ id: initial.id, body: saved.body })
  )
  expect(workspace.skills.has(initial.id)).toBe(false)

  function ReopenedEditor() {
    const detail = useQuery(userSkillQuery(initial.id))
    if (!detail.data) return null
    return (
      <EditorFields editor={workspace.ensureSkill(initial.id, detail.data)} />
    )
  }
  function EditorFields({
    editor,
  }: {
    editor: ReturnType<Workspace["ensureSkill"]>
  }) {
    const fields = useStore(editor.store, (state) => state.fields)
    return <p>{fields.body}</p>
  }
  render(
    <QueryClientProvider client={client}>
      <ReopenedEditor />
    </QueryClientProvider>
  )
  await waitFor(() =>
    expect(client.getQueryData(userSkillQuery(initial.id).queryKey)?.body).toBe(
      saved.body
    )
  )
  await waitFor(() => expect(screen.getByText(saved.body)).toBeInTheDocument())
})
