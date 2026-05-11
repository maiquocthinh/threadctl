import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolveCodexHome, getDbPath } from "./config";
import { copyThreads, copySpecificThreads, findThreadsByIds, type ThreadRow } from "./db";
import {
  findSessionsByProvider,
  findSessionsByIds,
  copySession,
  updateSessionIndex,
  type SessionMeta,
} from "./sessions";
import { createBackup, log, verbose, warn } from "./utils";
import { saveMappings, type SyncMapping } from "./mapping";

export interface SyncOptions {
  from: string;
  to: string;
  dryRun: boolean;
  bidirectional: boolean;
  codexHome?: string;
  threadIds?: string[]; // Optional: specific thread IDs to sync
}

export interface SyncResult {
  threadsCopied: number;
  threadsSkipped: number;
  sessionsCopied: number;
  sessionsSkipped: number;
  indexEntriesAdded: number;
}

async function syncOneDirection(
  codexHome: string,
  from: string,
  to: string,
  dryRun: boolean,
  threadIds?: string[]
): Promise<SyncResult> {
  log(`\nSync: "${from}" -> "${to}"${dryRun ? " [DRY RUN]" : ""}`);
  log("─".repeat(50));

  // --- SQLite threads ---
  const dbPath = getDbPath(codexHome);

  if (!existsSync(dbPath)) {
    warn(`Database not found: ${dbPath}`);
    return {
      threadsCopied: 0,
      threadsSkipped: 0,
      sessionsCopied: 0,
      sessionsSkipped: 0,
      indexEntriesAdded: 0,
    };
  }

  // Backup DB before modification (only on first actual write)
  if (!dryRun) {
    const backupPath = createBackup(dbPath);
    log(`DB backup: ${backupPath}`);
  }

  const db = new Database(dbPath);
  let threadResult: { copied: number; skipped: number; mappings: SyncMapping[] };
  let threadsToSync: ThreadRow[];

  try {
    if (threadIds && threadIds.length > 0) {
      // Sync specific threads
      threadsToSync = findThreadsByIds(db, threadIds);
      log(`Selected ${threadsToSync.length} threads to sync`);
      threadResult = copySpecificThreads(db, threadsToSync, to, dryRun);
    } else {
      // Sync all threads from provider
      threadResult = copyThreads(db, from, to, dryRun);
      threadsToSync = []; // Will be fetched from sessions
    }

    log(
      `Threads: ${threadResult.copied} copied, ${threadResult.skipped} skipped`
    );
  } finally {
    db.close();
  }

  // Save mappings
  if (!dryRun && threadResult.mappings.length > 0) {
    await saveMappings(codexHome, threadResult.mappings);
    verbose(`Saved ${threadResult.mappings.length} ID mappings`);
  }

  // --- JSONL sessions ---
  let sessions: SessionMeta[];

  if (threadIds && threadIds.length > 0) {
    // Find sessions for specific thread IDs
    sessions = await findSessionsByIds(codexHome, threadIds);
    log(`Found ${sessions.length} session files for selected threads`);
  } else {
    // Find all sessions for provider
    sessions = await findSessionsByProvider(codexHome, from);
    log(`Found ${sessions.length} session files with model_provider="${from}"`);
  }

  let sessionsCopied = 0;
  let sessionsSkipped = 0;

  for (const session of sessions) {
    const copied = await copySession(session, from, to, dryRun, codexHome);
    if (copied) {
      sessionsCopied++;
    } else {
      sessionsSkipped++;
    }
  }

  log(
    `Sessions: ${sessionsCopied} copied, ${sessionsSkipped} skipped`
  );

  // --- Session index ---
  const indexAdded = await updateSessionIndex(
    codexHome,
    sessions,
    to,
    dryRun
  );
  log(`Session index: ${indexAdded} entries added`);

  return {
    threadsCopied: threadResult.copied,
    threadsSkipped: threadResult.skipped,
    sessionsCopied,
    sessionsSkipped,
    indexEntriesAdded: indexAdded,
  };
}

export async function sync(options: SyncOptions): Promise<SyncResult[]> {
  const codexHome = resolveCodexHome(options.codexHome);
  log(`Codex home: ${codexHome}`);

  if (options.from === options.to) {
    throw new Error(`Source and target providers must be different ("${options.from}" = "${options.to}")`);
  }

  const results: SyncResult[] = [];

  // Forward sync: from -> to
  const forwardResult = await syncOneDirection(
    codexHome,
    options.from,
    options.to,
    options.dryRun,
    options.threadIds
  );
  results.push(forwardResult);

  // Reverse sync if bidirectional
  if (options.bidirectional) {
    const reverseResult = await syncOneDirection(
      codexHome,
      options.to,
      options.from,
      options.dryRun,
      options.threadIds
    );
    results.push(reverseResult);
  }

  return results;
}
