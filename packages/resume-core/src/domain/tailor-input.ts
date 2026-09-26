import { z } from "zod"

export const MAX_ADDITIONAL_INSTRUCTION_CHARS = 4_000
export const AdditionalInstructionSchema = z
  .string()
  .trim()
  .max(MAX_ADDITIONAL_INSTRUCTION_CHARS)

export const ApplyUrlSchema = z
  .url()
  .max(4_000)
  .refine((value) => {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
  }, "Use an HTTP or HTTPS application link without credentials")

export const TailorOptionsSchema = z.object({
  applyUrl: ApplyUrlSchema.nullable().optional(),
  additionalInstruction: AdditionalInstructionSchema.optional(),
})
export type TailorOptions = z.infer<typeof TailorOptionsSchema>
