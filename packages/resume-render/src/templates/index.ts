import type { TemplateDefinition, TemplateId } from "../types"
import { Atlas, Meridian } from "./two-column"
import { Harbor, Ledger, Lisbon, Plainsong } from "./single-column"

/**
 * The six templates the console's picker shows. `twoColumn` and `ruledHeader`
 * drive the miniature paper drawing in the picker, so they must match what the
 * PDF actually does.
 */
export const templates: Record<TemplateId, TemplateDefinition> = {
  lisbon: {
    id: "lisbon",
    name: "Lisbon",
    description: "Single column, blue rules",
    twoColumn: false,
    ruledHeader: true,
    accent: "#0069a8",
    Document: Lisbon,
  },
  meridian: {
    id: "meridian",
    name: "Meridian",
    description: "Sidebar for skills & contact",
    twoColumn: true,
    ruledHeader: false,
    accent: "#0084d1",
    Document: Meridian,
  },
  plainsong: {
    id: "plainsong",
    name: "Plainsong",
    description: "Pure black, no accents",
    twoColumn: false,
    ruledHeader: false,
    accent: "#0a0a0a",
    Document: Plainsong,
  },
  harbor: {
    id: "harbor",
    name: "Harbor",
    description: "Wide header band",
    twoColumn: false,
    ruledHeader: true,
    accent: "#00a6f4",
    Document: Harbor,
  },
  ledger: {
    id: "ledger",
    name: "Ledger",
    description: "Dense, fits 12+ roles",
    twoColumn: false,
    ruledHeader: false,
    accent: "#00598a",
    Document: Ledger,
  },
  atlas: {
    id: "atlas",
    name: "Atlas",
    description: "Two column, academic CV",
    twoColumn: true,
    ruledHeader: false,
    accent: "#74d4ff",
    Document: Atlas,
  },
}

export const templateList: TemplateDefinition[] = Object.values(templates)
