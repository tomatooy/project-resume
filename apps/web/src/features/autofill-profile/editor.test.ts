import { expect, it } from "vitest"
import { ProfileEditor } from "./editor"
import { AutofillProfileService } from "@workspace/resume-core"
import { InMemoryAutofillProfileRepository } from "@workspace/resume-core/testing"

it("serializes section saves and keeps the independent draft in memory", async () => {
  const service = new AutofillProfileService(
    new InMemoryAutofillProfileRepository()
  )
  const editor = new ProfileEditor(
    await service.get(),
    (v) => service.update(v),
    () => service.get()
  )
  editor.set("identity", {
    ...editor.store.state.draft.identity,
    legalGivenName: "Ada",
  })
  editor.set("address", { ...editor.store.state.draft.address, city: "Boston" })
  expect((await service.get()).data.identity.legalGivenName).toBe("")
  await editor.save()
  expect(editor.store.state.saved.revision).toBe(2)
  expect(editor.store.state.dirty).toBe(false)
})
it("retains the draft after conflict and requires explicit reconciliation", async () => {
  const service = new AutofillProfileService(
    new InMemoryAutofillProfileRepository()
  )
  const editor = new ProfileEditor(
    await service.get(),
    (v) => service.update(v),
    () => service.get()
  )
  editor.set("identity", {
    ...editor.store.state.draft.identity,
    legalGivenName: "Draft",
  })
  await service.update({
    expectedRevision: 0,
    section: "identity",
    data: {
      ...editor.store.state.draft.identity,
      legalGivenName: "Saved elsewhere",
    },
  })
  await expect(editor.save()).rejects.toMatchObject({ code: "CONFLICT" })
  expect(editor.store.state.draft.identity.legalGivenName).toBe("Draft")
  expect(editor.store.state.conflict?.data.identity.legalGivenName).toBe(
    "Saved elsewhere"
  )
  await expect(editor.save()).rejects.toThrow("Review")
  editor.reconcile()
  await editor.save()
  expect((await service.get()).data.identity.legalGivenName).toBe("Draft")
})

it("reconciles untouched sections without overwriting another tab's changes", async () => {
  const service = new AutofillProfileService(
    new InMemoryAutofillProfileRepository()
  )
  const initial = await service.get()
  const editor = new ProfileEditor(
    initial,
    (v) => service.update(v),
    () => service.get()
  )
  editor.set("identity", { ...initial.data.identity, legalGivenName: "Local" })
  await service.update({
    expectedRevision: 0,
    section: "address",
    data: { ...initial.data.address, city: "Remote city" },
  })
  await expect(editor.save()).rejects.toMatchObject({ code: "CONFLICT" })
  editor.reconcile()
  await editor.save()
  expect((await service.get()).data.address.city).toBe("Remote city")
  expect((await service.get()).data.identity.legalGivenName).toBe("Local")
})
it("keeps edits made while a save is in flight", async () => {
  const service = new AutofillProfileService(
    new InMemoryAutofillProfileRepository()
  )
  const initial = await service.get()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const editor = new ProfileEditor(
    initial,
    async (v) => {
      await gate
      return service.update(v)
    },
    () => service.get()
  )
  editor.set("identity", { ...initial.data.identity, legalGivenName: "First" })
  const saving = editor.save("identity")
  editor.set("identity", { ...initial.data.identity, legalGivenName: "Newer" })
  release()
  await saving
  expect(editor.store.state.draft.identity.legalGivenName).toBe("Newer")
  expect(editor.store.state.dirty).toBe(true)
  expect((await service.get()).data.identity.legalGivenName).toBe("First")
})
it("queues a save-all behind an in-flight section save before allowing a close", async () => {
  const service = new AutofillProfileService(
    new InMemoryAutofillProfileRepository()
  )
  const initial = await service.get()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const revisions: number[] = []
  const editor = new ProfileEditor(
    initial,
    async (v) => {
      revisions.push(v.expectedRevision)
      await gate
      return service.update(v)
    },
    () => service.get()
  )
  editor.set("identity", { ...initial.data.identity, legalGivenName: "Ada" })
  editor.set("address", { ...initial.data.address, city: "Boston" })
  const section = editor.save("identity")
  const closing = editor.save()
  expect(revisions).toEqual([0])
  release()
  await Promise.all([section, closing])
  expect(revisions).toEqual([0, 1])
  expect(editor.store.state.dirty).toBe(false)
  expect((await service.get()).data.address.city).toBe("Boston")
})
