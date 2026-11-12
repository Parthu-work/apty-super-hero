/** IndexedDB databases the Agent opens. ZenFS names its one object store after its database. */
export const CONVERSATIONS_DB = "apty-conversations-db";
export const SCREENSHOTS_DB = "apty-screenshots-db";
export const SKILLS_FS_DB = "apty-skills-fs";
export const SKILLS_DB = "apty-skills-db";
export const KB_DB = "apty-kb-db";
/** The record of model requests that carried KB text (KB-RAG K22, S7): ids, never text. */
export const KB_EGRESS_DB = "apty-kb-egress-db";
/** Cases and wrong-card feedback (KB-RAG K25, L1, L3): on the device only, ids and the SE's own redacted words. */
export const CASES_DB = "apty-cases-db";
