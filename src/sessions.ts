import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { getSessionsDir, getSessionIndexPath } from "./config";
import { generateSyncId, verbose, warn, log } from "./utils";
import { loadMappings } from "./mapping";

export interface SessionMeta {
  filePath: string;
  id: string;
  modelProvider: string;
  threadName?: string;
  timestamp?: string;
}

/**
 * Recursively scan for all .jsonl files under sessions directory.
 */
export async function scanJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await scanJsonlFiles(fullPath);
      results.push(...sub);
    } else if (entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Parse the first line of a JSONL session file to extract metadata.
 */
export async function parseSessionMeta(filePath: string): Promise<SessionMeta | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const firstLine = content.split("\n")[0];
    if (!firstLine) return null;

    const parsed = JSON.parse(firstLine);

    // Session meta format: {"timestamp":"...","type":"session_meta","payload":{"id":"...","model_provider":"...",...}}
    if (parsed.type !== "session_meta" || !parsed.payload) return null;

    return {
      filePath,
      id: parsed.payload.id,
      modelProvider: parsed.payload.model_provider,
      threadName: parsed.payload.thread_name,
      timestamp: parsed.payload.timestamp,
    };
  } catch {
    return null;
  }
}

/**
 * Scan all sessions and filter by provider.
 */
export async function findSessionsByProvider(
  codexHome: string,
  provider: string
): Promise<SessionMeta[]> {
  const sessionsDir = getSessionsDir(codexHome);
  const files = await scanJsonlFiles(sessionsDir);
  verbose(`Found ${files.length} JSONL files in sessions/`);

  const sessions: SessionMeta[] = [];

  for (const filePath of files) {
    const meta = await parseSessionMeta(filePath);
    if (meta && meta.modelProvider === provider) {
      sessions.push(meta);
    }
  }

  return sessions;
}

/**
 * Find sessions by thread IDs.
 */
export async function findSessionsByIds(
  codexHome: string,
  ids: string[]
): Promise<SessionMeta[]> {
  if (ids.length === 0) return [];

  const sessionsDir = getSessionsDir(codexHome);
  const files = await scanJsonlFiles(sessionsDir);
  const idSet = new Set(ids);

  const sessions: SessionMeta[] = [];

  for (const filePath of files) {
    const meta = await parseSessionMeta(filePath);
    if (meta && idSet.has(meta.id)) {
      sessions.push(meta);
    }
  }

  return sessions;
}

/**
 * Generate the output file path for a synced session.
 * Creates a new filename with the new UUID and current timestamp.
 * e.g., rollout-2026-05-07T20-51-33-019e02b5-41e8-7b42-a1fc-5419c35806ae.jsonl
 *   ->  rollout-2026-05-10T17-57-31-a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl
 */
function getSyncedFilePath(
  originalPath: string,
  newId: string
): string {
  const dir = dirname(originalPath);

  // Generate new timestamp in the same format
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/\.\d{3}Z$/, '')  // Remove milliseconds and Z
    .replace(/:/g, '-');        // Replace : with -

  const newName = `rollout-${timestamp}-${newId}.jsonl`;

  return join(dir, newName);
}

/**
 * Copy a session JSONL file with replaced provider and ID.
 * Returns true if copied, false if skipped (already exists).
 */
export async function copySession(
  session: SessionMeta,
  sourceProvider: string,
  targetProvider: string,
  dryRun: boolean,
  codexHome: string
): Promise<boolean> {
  // Load mappings to find the new ID for this session
  const mappings = await loadMappings(codexHome);
  const mapping = mappings.find(m => m.originalId === session.id && m.targetProvider === targetProvider);

  if (!mapping) {
    warn(`No mapping found for session ${session.id}, skipping`);
    return false;
  }

  const newId = mapping.newId;
  const outputPath = getSyncedFilePath(session.filePath, newId);

  if (existsSync(outputPath)) {
    verbose(`Skip existing session file: ${basename(outputPath)}`);
    return false;
  }

  if (dryRun) {
    verbose(
      `[dry-run] Would copy: ${basename(session.filePath)} -> ${basename(outputPath)}`
    );
    return true;
  }

  const content = await readFile(session.filePath, "utf-8");

  // Replace model_provider values — handle both quoted forms:
  //   "model_provider":"openai"  and  "model_provider": "openai"
  let modified = content.replace(
    new RegExp(
      `"model_provider"\\s*:\\s*"${escapeRegex(sourceProvider)}"`,
      "g"
    ),
    `"model_provider":"${targetProvider}"`
  );

  // Replace all occurrences of the original session ID with new ID
  modified = modified.replace(
    new RegExp(escapeRegex(session.id), "g"),
    newId
  );

  await writeFile(outputPath, modified, "utf-8");
  verbose(`Copied session: ${basename(session.filePath)} -> ${basename(outputPath)}`);

  return true;
}

/**
 * Append new entries to session_index.jsonl for synced sessions.
 */
export async function updateSessionIndex(
  codexHome: string,
  sessions: SessionMeta[],
  targetProvider: string,
  dryRun: boolean
): Promise<number> {
  const indexPath = getSessionIndexPath(codexHome);

  // Load mappings to get new IDs
  const mappings = await loadMappings(codexHome);

  // Read existing index to check for duplicates AND get thread names
  let existingIds = new Set<string>();
  let threadNames = new Map<string, string>(); // originalId -> thread_name

  if (existsSync(indexPath)) {
    const content = await readFile(indexPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        existingIds.add(entry.id);
        // Store thread name by ID
        if (entry.id && entry.thread_name) {
          threadNames.set(entry.id, entry.thread_name);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  const newEntries: string[] = [];

  for (const session of sessions) {
    // Find the new ID from mapping
    const mapping = mappings.find(m => m.originalId === session.id && m.targetProvider === targetProvider);
    if (!mapping) {
      verbose(`No mapping found for session ${session.id}, skipping index update`);
      continue;
    }

    const newId = mapping.newId;

    if (existingIds.has(newId)) {
      verbose(`Skip existing index entry: ${newId}`);
      continue;
    }

    // Get thread name from session_index.jsonl using original ID
    const threadName = threadNames.get(session.id) || session.threadName || "Synced thread";
    const updatedAt = new Date().toISOString();

    const entry = JSON.stringify({
      id: newId,
      thread_name: threadName,
      updated_at: updatedAt,
    });

    newEntries.push(entry);
  }

  if (newEntries.length > 0 && !dryRun) {
    const appendContent = "\n" + newEntries.join("\n");
    await writeFile(indexPath, appendContent, { flag: "a" });
  }

  if (dryRun && newEntries.length > 0) {
    verbose(
      `[dry-run] Would append ${newEntries.length} entries to session_index.jsonl`
    );
  }

  return newEntries.length;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
