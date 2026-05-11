import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCodexHome(override?: string): string {
  if (override) return expandHome(override);
  if (process.env.CODEX_HOME) return expandHome(process.env.CODEX_HOME);
  return join(homedir(), ".codex");
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function getDbPath(codexHome: string): string {
  return join(codexHome, "state_5.sqlite");
}

export function getSessionsDir(codexHome: string): string {
  return join(codexHome, "sessions");
}

export function getSessionIndexPath(codexHome: string): string {
  return join(codexHome, "session_index.jsonl");
}

export function getMappingFilePath(codexHome: string): string {
  return join(codexHome, ".threadctl-mappings.jsonl");
}
