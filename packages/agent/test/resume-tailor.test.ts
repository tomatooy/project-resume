import { starter } from "@workspace/resume-schema/fixtures"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"

import { createResumeTailor } from "../src/job"
import { testModels, textGenerate } from "./mock"

const POSTING = {
  title: "Senior Engineer",
  company: "Acme",
  mustHaves: ["TypeScript"],
  niceToHaves: ["React"],
  keywords: ["Postgres"],
}

describe("createResumeTailor", () => {
  it("puts the posting and the document in the prompt and reports the model", async () => {
    const model = new MockLanguageModelV3({
      modelId: "smart-test",
      doGenerate: [
        textGenerate(JSON.stringify({ basics: { name: "Ada" }, sections: [] })),
      ],
    })
    const models = testModels(model)

    const result = await createResumeTailor(models).tailor({
      resume: starter,
      posting: POSTING,
    })

    expect(result.model).toBe(models.ids.smart)
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    expect(prompt).toContain("Senior Engineer")
    expect(prompt).toContain("TypeScript")
    expect(prompt).toContain(starter.basics.name ?? "")
  })
})
