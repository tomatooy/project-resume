import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"

import { createJobParser } from "../src/job"
import { testModels, textGenerate } from "./mock"

const PARSED = {
  title: "Senior Engineer",
  company: "Acme",
  mustHaves: ["TypeScript"],
  niceToHaves: [],
  keywords: ["React"],
}

describe("createJobParser", () => {
  it("passes the posting through and reports the smart model id", async () => {
    const model = new MockLanguageModelV3({
      modelId: "smart-test",
      doGenerate: [textGenerate(JSON.stringify(PARSED))],
    })
    const models = testModels(model)

    const result = await createJobParser(models).parse({ text: "posting text" })

    expect(result.parsed.company).toBe("Acme")
    expect(result.model).toBe(models.ids.smart)

    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    expect(prompt).toContain("posting text")
  })

  it("forwards the abort signal to the model call", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        textGenerate(
          JSON.stringify({
            title: "",
            company: "",
            mustHaves: [],
            niceToHaves: [],
            keywords: [],
          })
        ),
      ],
    })
    const controller = new AbortController()

    await createJobParser(testModels(model)).parse({
      text: "posting text",
      signal: controller.signal,
    })

    expect(model.doGenerateCalls[0]?.abortSignal).toBe(controller.signal)
  })
})
