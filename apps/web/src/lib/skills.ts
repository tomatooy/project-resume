/**
 * The panel's view of the playbook library.
 *
 * It reads the catalog subpath rather than the library, so the playbook bodies
 * never reach the browser bundle: a chip label, a tooltip and a card's
 * attribution all need the index, and none of them need the prompt text. The
 * hint travels to the server as a plain string, because the server answers an
 * id it does not hold rather than refusing the request.
 */
export {
  SKILL_META,
  type SkillId,
  skillMetaOf,
} from "@workspace/agent/skills"
