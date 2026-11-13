// Where the built-in course is read from: seed/live/ (the maintainer's real lessons, gitignored) when it exists,
// otherwise seed/example/ (one sample lesson per level, committed). See seed/README.md.
import { existsSync } from "node:fs";

const live = new URL("../seed/live/", import.meta.url);
export const SEED_DIR = existsSync(live) ? live : new URL("../seed/example/", import.meta.url);
export const SEED_NAME = existsSync(live) ? "seed/live" : "seed/example";
