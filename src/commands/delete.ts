import { parseArgs } from "node:util";
import { Database } from "bun:sqlite";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolveCodexHome, getDbPath, getSessionIndexPath, getMappingFilePath } from "../config";
import { setVerbose, log, error, createBackup } from "../utils";
import { findThreadsByProvider, findThreadsByIds } from "../db";
import { findSessionsByIds } from "../sessions";
import { loadMappings } from "../mapping";
import { selectThreadIds } from "../interactive";
import type { ThreadRow } from "../db";
import type { SyncMapping } from "../mapping";

/**
 * Delete threads from database
 */
function deleteThreadsFromDb(db: Database, threadIds: string[]): number {
  if (threadIds.length === 0) return 0;

  const placeholders = threadIds.map(() => "?").join(", ");
  const sql = `DELETE FROM threads WHERE id IN (${placeholders})`;
  const stmt = db.prepare(sql);
  const result = stmt.run(...threadIds);
  return result.changes;
}

/**
 * Rewrite mappings file without deleted entries
 */
async function rewriteMappingsFile(
  codexHome: string,
  deletedIds: Set<string>
): Promise<number> {
  const mappingsPath = getMappingFilePath(codexHome);

  if (!existsSync(mappingsPath)) {
    return 0;
  }

  const mappings = await loadMappings(codexHome);
  const validMappings = mappings.filter(
    m => !deletedIds.has(m.originalId) && !deletedIds.has(m.newId)
  );

  const removedCount = mappings.length - validMappings.length;

  if (validMappings.length === 0) {
    await unlink(mappingsPath);
  } else {
    const content = validMappings.map(m => JSON.stringify(m)).join("\n") + "\n";
    await writeFile(mappingsPath, content, "utf-8");
  }

  return removedCount;
}

/**
 * Rewrite session index without deleted entries
 */
async function rewriteSessionIndex(
  codexHome: string,
  deletedIds: Set<string>
): Promise<number> {
  const indexPath = getSessionIndexPath(codexHome);

  if (!existsSync(indexPath)) {
    return 0;
  }

  const content = await readFile(indexPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const validLines: string[] = [];
  let removedCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.id && !deletedIds.has(entry.id)) {
        validLines.push(line);
      } else {
        removedCount++;
      }
    } catch {
      // Keep malformed lines
      validLines.push(line);
    }
  }

  if (validLines.length === 0) {
    await unlink(indexPath);
  } else {
    const newContent = validLines.join("\n") + "\n";
    await writeFile(indexPath, newContent, "utf-8");
  }

  return removedCount;
}

export async function deleteCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      id: { type: "string" },
      ids: { type: "string" },
      provider: { type: "string" },
      interactive: { type: "boolean", short: "i", default: false },
      "dry-run": { type: "boolean", short: "d", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "keep-sessions": { type: "boolean", default: false },
      "keep-mappings": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "codex-home": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
threadctl delete — Delete threads and associated files

Usage:
  threadctl delete [options]

Options:
  --id <thread-id>         Delete single thread
  --ids <id1,id2,...>      Delete multiple threads (comma-separated)
  --provider <provider>    Delete all threads from provider
  -i, --interactive        Select provider threads interactively
  -d, --dry-run            Preview deletion without making changes
  -y, --yes                Skip confirmation prompt
  --keep-sessions          Don't delete session files
  --keep-mappings          Don't clean up mappings
  -v, --verbose            Show detailed progress
  --codex-home <path>      Override Codex data directory (default: ~/.codex)
  -h, --help               Show this help message

Examples:
  # Delete single thread (with confirmation)
  threadctl delete --id "019d7fa3-be4f-7d42-a1fc-5419c35806ae"

  # Delete multiple threads
  threadctl delete --ids "id1,id2,id3"

  # Delete all threads from a provider
  threadctl delete --provider openai --dry-run

  # Select provider threads interactively
  threadctl delete --provider openai --interactive

  # Delete without confirmation
  threadctl delete --provider openai --yes
`);
    process.exit(0);
  }

  // Validate options
  if (!values.id && !values.ids && !values.provider) {
    error("Must specify --id, --ids, or --provider");
    process.exit(1);
  }

  if (values.interactive && !values.provider) {
    error("--interactive requires --provider");
    process.exit(1);
  }

  setVerbose(values.verbose ?? false);

  log("threadctl delete");
  log("=".repeat(50));

  try {
    const codexHome = resolveCodexHome(values["codex-home"]);
    const dbPath = getDbPath(codexHome);

    if (!existsSync(dbPath)) {
      error("Database not found.");
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    let threadsToDelete: ThreadRow[] = [];

    try {
      // Find threads to delete
      if (values.provider) {
        threadsToDelete = findThreadsByProvider(db, values.provider);
        log(`Found ${threadsToDelete.length} threads with provider="${values.provider}"`);
      } else if (values.id) {
        threadsToDelete = findThreadsByIds(db, [values.id]);
        if (threadsToDelete.length === 0) {
          error(`Thread not found: ${values.id}`);
          process.exit(1);
        }
      } else if (values.ids) {
        const ids = values.ids.split(",").map(id => id.trim()).filter(Boolean);
        threadsToDelete = findThreadsByIds(db, ids);
        log(`Found ${threadsToDelete.length} of ${ids.length} threads`);
      }
    } finally {
      db.close();
    }

    if (threadsToDelete.length === 0) {
      log("\n✅ No threads to delete.");
      return;
    }

    if (values.interactive) {
      const selectedIds = selectThreadIds(codexHome, threadsToDelete, "delete");
      if (selectedIds.length === 0) {
        log("\nNo threads selected. Exiting.");
        return;
      }
      const selectedIdSet = new Set(selectedIds);
      threadsToDelete = threadsToDelete.filter(t => selectedIdSet.has(t.id));
    }

    const threadIds = threadsToDelete.map(t => t.id);

    // Find associated sessions
    const sessions = values["keep-sessions"] ? [] : await findSessionsByIds(codexHome, threadIds);

    // Find associated mappings
    let mappingsToRemove = 0;
    if (!values["keep-mappings"]) {
      const mappings = await loadMappings(codexHome);
      const threadIdSet = new Set(threadIds);
      mappingsToRemove = mappings.filter(
        m => threadIdSet.has(m.originalId) || threadIdSet.has(m.newId)
      ).length;
    }

    // Display deletion plan
    log("");
    log("Deletion plan:");
    log(`  Threads to delete:      ${threadsToDelete.length}`);
    log(`  Sessions to delete:     ${sessions.length}`);
    log(`  Mappings to remove:     ${mappingsToRemove}`);
    log(`  Index entries to remove: ${threadsToDelete.length}`);

    if (values.verbose && threadsToDelete.length > 0) {
      log("\nThreads:");
      for (const thread of threadsToDelete.slice(0, 10)) {
        log(`  ${thread.id} - ${thread.title || thread.thread_name || "(no name)"} [${thread.model_provider}]`);
      }
      if (threadsToDelete.length > 10) {
        log(`  ... and ${threadsToDelete.length - 10} more`);
      }
    }

    if (values["dry-run"]) {
      log("\n(Dry run — no changes were made)");
      return;
    }

    // Confirm before proceeding
    if (!values.yes) {
      const confirm = prompt("\nProceed with deletion? This cannot be undone. (y/n): ");
      if (confirm?.toLowerCase() !== "y") {
        log("Deletion cancelled.");
        process.exit(0);
      }
    }

    // Execute deletion
    log("\nDeleting...");

    // Backup database
    await createBackup(dbPath);
    log("Database backed up");

    // Delete threads from database
    const dbWrite = new Database(dbPath);
    let deletedThreads = 0;
    try {
      deletedThreads = deleteThreadsFromDb(dbWrite, threadIds);
    } finally {
      dbWrite.close();
    }

    // Delete session files
    let deletedSessions = 0;
    if (!values["keep-sessions"] && sessions.length > 0) {
      for (const session of sessions) {
        try {
          await unlink(session.filePath);
          deletedSessions++;
        } catch (e: any) {
          error(`Failed to delete ${session.filePath}: ${e.message}`);
        }
      }
    }

    // Rewrite session index
    const deletedIdSet = new Set(threadIds);
    const removedIndexEntries = await rewriteSessionIndex(codexHome, deletedIdSet);

    // Rewrite mappings file
    let removedMappings = 0;
    if (!values["keep-mappings"]) {
      removedMappings = await rewriteMappingsFile(codexHome, deletedIdSet);
    }

    log("\n" + "=".repeat(50));
    log("Summary:");
    log(`  Threads deleted:        ${deletedThreads}`);
    log(`  Sessions deleted:       ${deletedSessions}`);
    log(`  Index entries removed:  ${removedIndexEntries}`);
    log(`  Mappings removed:       ${removedMappings}`);
    log("\n✅ Deletion complete.");
  } catch (e: any) {
    error(e.message);
    process.exit(1);
  }
}
