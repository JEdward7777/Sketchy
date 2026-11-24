import { DurableObject } from 'cloudflare:workers';

/**
 * The singleton global word deck (`SPEC.md` §6). Phase 1 shell: it exists, is
 * SQLite-backed (migration `new_sqlite_classes`), and does nothing yet. The
 * deck itself is phase 5.
 */
export class DeckDO extends DurableObject<Env> {}
