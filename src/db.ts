import { Database } from "bun:sqlite";
import { generateSyncId, verbose, warn, log } from "./utils";
import type { SyncMapping } from "./mapping";

export interface ThreadRow {
  [key: string]: unknown;
  id: string;
  model_provider: string;
  title?: string;
  thread_name?: string;
  cwd?: string;
  updated_at?: string;
}

/**
 * Read the schema of the threads table dynamically.
 * Returns column names so we can copy all columns without hardcoding.
 */
export function readThreadsSchema(db: Database): string[] {
  const info = db.query("PRAGMA table_info(threads)").all() as {
    name: string;
    type: string;
  }[];
  return info.map((col) => col.name);
}

/**
 * Find all threads matching a specific model_provider.
 */
export function findThreadsByProvider(
  db: Database,
  provider: string
): ThreadRow[] {
  return db
    .query("SELECT * FROM threads WHERE model_provider = ? ORDER BY updated_at DESC")
    .all(provider) as ThreadRow[];
}

/**
 * Find threads by IDs.
 */
export function findThreadsByIds(
  db: Database,
  ids: string[]
): ThreadRow[] {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(", ");
  const sql = `SELECT * FROM threads WHERE id IN (${placeholders})`;
  return db.query(sql).all(...ids) as ThreadRow[];
}

/**
 * Check if a thread with the given ID already exists.
 */
export function threadExists(db: Database, id: string): boolean {
  const row = db
    .query("SELECT 1 FROM threads WHERE id = ?")
    .get(id) as { "1": number } | null;
  return row !== null;
}

/**
 * Copy specific threads from source provider to target provider.
 * Creates new records with modified IDs and target provider.
 * Returns { copied, skipped, mappings } counts.
 */
export function copySpecificThreads(
  db: Database,
  threads: ThreadRow[],
  targetProvider: string,
  dryRun: boolean
): { copied: number; skipped: number; mappings: SyncMapping[] } {
  const columns = readThreadsSchema(db);
  verbose(`Threads table columns: ${columns.join(", ")}`);

  if (threads.length === 0) {
    return { copied: 0, skipped: 0, mappings: [] };
  }

  let copied = 0;
  let skipped = 0;
  const mappings: SyncMapping[] = [];

  if (dryRun) {
    for (const thread of threads) {
      const newId = generateSyncId(thread.id, targetProvider);
      if (threadExists(db, newId)) {
        verbose(`[dry-run] Skip existing: ${newId}`);
        skipped++;
      } else {
        verbose(`[dry-run] Would copy: ${thread.id} -> ${newId}`);
        copied++;
      }
    }
    return { copied, skipped, mappings };
  }

  // Build INSERT statement dynamically
  const placeholders = columns.map(() => "?").join(", ");
  const insertSql = `INSERT OR IGNORE INTO threads (${columns.join(", ")}) VALUES (${placeholders})`;
  const insertStmt = db.prepare(insertSql);

  const transaction = db.transaction(() => {
    for (const thread of threads) {
      const newId = generateSyncId(thread.id, targetProvider);

      if (threadExists(db, newId)) {
        verbose(`Skip existing: ${newId}`);
        skipped++;
        continue;
      }

      // Build values array matching column order
      const values = columns.map((col): any => {
        if (col === "id") return newId;
        if (col === "model_provider") return targetProvider;
        return thread[col] ?? null;
      });

      try {
        insertStmt.run(...values);
        verbose(`Copied: ${thread.id} -> ${newId}`);
        copied++;

        // Save mapping
        mappings.push({
          originalId: thread.id,
          newId,
          sourceProvider: thread.model_provider,
          targetProvider,
          syncedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        // INSERT OR IGNORE handles duplicates, but catch unexpected errors
        if (e.message?.includes("UNIQUE constraint")) {
          verbose(`Skip duplicate: ${newId}`);
          skipped++;
        } else {
          warn(`Failed to copy thread ${thread.id}: ${e.message}`);
        }
      }
    }
  });

  transaction();

  return { copied, skipped, mappings };
}

/**
 * Copy threads from source provider to target provider.
 * Creates new records with modified IDs and target provider.
 * Returns { copied, skipped, mappings } counts.
 */
export function copyThreads(
  db: Database,
  sourceProvider: string,
  targetProvider: string,
  dryRun: boolean
): { copied: number; skipped: number; mappings: SyncMapping[] } {
  const threads = findThreadsByProvider(db, sourceProvider);
  log(`Found ${threads.length} threads with model_provider="${sourceProvider}"`);
  return copySpecificThreads(db, threads, targetProvider, dryRun);
}
