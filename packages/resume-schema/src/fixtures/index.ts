export { starter } from "./starter"
export { minimal, onePage, twoPage, longBullets, unicode } from "./samples"
export {
  pageExpectations,
  type ExpectationTemplateId,
  type FixtureName,
} from "./expectations"
export { fid } from "./build"

import { minimal, onePage, twoPage, longBullets, unicode } from "./samples"
import type { Resume } from "../schema"

export const fixtures: Record<string, Resume> = {
  minimal,
  onePage,
  twoPage,
  longBullets,
  unicode,
}
