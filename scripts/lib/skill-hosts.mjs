// User skill folders of the supported agent hosts. install-skill.mjs installs into them, and
// update-skill.mjs updates the copies it finds there.

import os from 'node:os';
import path from 'node:path';

/** Skill folder of each supported host, resolved from the current environment. */
export function skillHostRoots() {
  return {
    codex: path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'skills'),
    claude: path.join(os.homedir(), '.claude', 'skills'),
    cursor: path.join(os.homedir(), '.cursor', 'skills'),
    agents: path.join(os.homedir(), '.agents', 'skills'),
  };
}
