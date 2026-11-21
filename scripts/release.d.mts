// What scripts/release.mjs exports, for its tests (tests/unit/release.test.ts).

/** A download's name with the system it's for: `lines_0.3.3_macos_universal.dmg`. */
export function downloadName(file: string, version: string): string;

/** A commit as the release notes read it. */
export interface Commit {
  hash?: string;
  type?: string;
  subject: string;
  body: string;
}

/** `commits` less the changes reverted among them, and those reverts. */
export function withoutReverted<C extends Commit>(commits: C[]): C[];
