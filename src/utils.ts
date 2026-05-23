import { copyFileSync } from "node:fs";

/**
 * Generate a new UUID for synced thread.
 */
export function generateSyncId(): string {
  return crypto.randomUUID();
}

/**
 * Create a backup copy of a file (append .bak timestamp).
 */
export function createBackup(filePath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak-${ts}`;
  copyFileSync(filePath, backupPath);
  return backupPath;
}

// --- Logger ---

let verboseEnabled = false;

export function setVerbose(v: boolean) {
  verboseEnabled = v;
}

export function log(msg: string) {
  console.log(msg);
}

export function verbose(msg: string) {
  if (verboseEnabled) console.log(`  [verbose] ${msg}`);
}

export function warn(msg: string) {
  console.log(`  [warn] ${msg}`);
}

export function error(msg: string) {
  console.error(`  [error] ${msg}`);
}
