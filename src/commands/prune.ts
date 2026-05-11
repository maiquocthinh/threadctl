import { parseArgs } from "node:util";
import { Database } from "bun:sqlite";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolveCodexHome, getDbPath, getSessionsDir, getSessionIndexPath, getMappingFilePath } from "../config";
import { setVerbose, log, error } from "../utils";
import { scanJsonlFiles, parseSessionMeta } from "../sessions";
import { loadMappings } from "../mapping";
import type { SessionMeta } from "../sessions";
import type { SyncMapping } from "../mapping";

/**
 * Find all thread IDs that exist in the database
 */
function getAllThreadIds(db: Database): Set<string> {
  const rows = db.query("SELECT id FROM threads").all() as { id: string }[];
  return new Set(rows.map(r => r.id));
}

/**
 * Find orphaned sessions (session files whose thread ID doesn't exist in DB)
 */
async function findOrphanedSessions(
  codexHome: string,
  allThreadIds: Set<string>
): Promise<SessionMeta[]> {
  const sessionsDir = getSessionsDir(codexHome);
  const files = await scanJsonlFiles(sessionsDir);

  const orphaned: SessionMeta[] = [];

  for (const filePath of files) {
    const meta = await parseSessionMeta(filePath);
    if (meta && !allThreadIds.has(meta.id)) {
      orphaned.push(meta);
    }
  }

  return orphaned;
}

/**
 * Find orphaned mappings (mappings where neither originalId nor newId exists in DB)
 */
function findOrphanedMappings(
  mappings: SyncMapping[],
  allThreadIds: Set<string>
): SyncMapping[] {
  return mappings.filter(
    m => !allThreadIds.has(m.originalId) && !allThreadIds.has(m.newId)
  );
}

/**
 * Find orphaned index entries (entries whose ID doesn't exist in DB)
 */
async function findOrphanedIndexEntries(
  codexHome: string,
  allThreadIds: Set<string>
): Promise<{ id: string; thread_name?: string }[]> {
  const indexPath = getSessionIndexPath(codexHome);

  if (!existsSync(indexPath)) {
    return [];
  }

  const content = await readFile(indexPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const orphaned: { id: string; thread_name?: string }[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.id && !allThreadIds.has(entry.id)) {
        orphaned.push({ id: entry.id, thread_name: entry.thread_name });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return orphaned;
}

/**
 * Rewrite mappings file without orphaned entries
 */
async function rewriteMappingsFile(
  codexHome: string,
  validMappings: SyncMapping[]
): Promise<void> {
  const mappingsPath = getMappingFilePath(codexHome);

  if (validMappings.length === 0) {
    // If no valid mappings, delete the file
    if (existsSync(mappingsPath)) {
      await unlink(mappingsPath);
    }
    return;
  }

  const content = validMappings.map(m => JSON.stringify(m)).join("\n") + "\n";
  await writeFile(mappingsPath, content, "utf-8");
}

/**
 * Rewrite session index without orphaned entries
 */
async function rewriteSessionIndex(
  codexHome: string,
  allThreadIds: Set<string>
): Promise<void> {
  const indexPath = getSessionIndexPath(codexHome);

  if (!existsSync(indexPath)) {
    return;
  }

  const content = await readFile(indexPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const validLines: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.id && allThreadIds.has(entry.id)) {
        validLines.push(line);
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (validLines.length === 0) {
    // If no valid entries, delete the file
    await unlink(indexPath);
    return;
  }

  const newContent = validLines.join("\n") + "\n";
  await writeFile(indexPath, newContent, "utf-8");
}

export async function pruneCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", short: "d", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "sessions-only": { type: "boolean", default: false },
      "mappings-only": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "codex-home": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
threadctl prune — Clean up orphaned files

Usage:
  threadctl prune [options]

Options:
  -d, --dry-run            Preview pruning without making changes
  -y, --yes                Skip confirmation prompt
  --sessions-only          Only prune session files
  --mappings-only          Only prune mappings
  -v, --verbose            Show detailed progress
  --codex-home <path>      Override Codex data directory (default: ~/.codex)
  -h, --help               Show this help message

Examples:
  # Preview what would be pruned
  threadctl prune --dry-run

  # Prune with confirmation
  threadctl prune

  # Prune without confirmation
  threadctl prune --yes

  # Only prune session files
  threadctl prune --sessions-only
`);
    process.exit(0);
  }

  setVerbose(values.verbose ?? false);

  log("threadctl prune");
  log("=".repeat(50));

  try {
    const codexHome = resolveCodexHome(values["codex-home"]);
    const dbPath = getDbPath(codexHome);

    if (!existsSync(dbPath)) {
      error("Database not found. Cannot determine valid threads.");
      process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    let allThreadIds: Set<string>;

    try {
      allThreadIds = getAllThreadIds(db);
      log(`Found ${allThreadIds.size} threads in database`);
    } finally {
      db.close();
    }

    // Find orphaned items
    const orphanedSessions = values["mappings-only"] ? [] : await findOrphanedSessions(codexHome, allThreadIds);
    const mappings = values["sessions-only"] ? [] : await loadMappings(codexHome);
    const orphanedMappings = values["sessions-only"] ? [] : findOrphanedMappings(mappings, allThreadIds);
    const orphanedIndexEntries = values["mappings-only"] ? [] : await findOrphanedIndexEntries(codexHome, allThreadIds);

    // Display prune plan
    log("");
    log("Prune plan:");
    log(`  Orphaned sessions:      ${orphanedSessions.length}`);
    log(`  Orphaned mappings:      ${orphanedMappings.length}`);
    log(`  Orphaned index entries: ${orphanedIndexEntries.length}`);

    if (orphanedSessions.length === 0 && orphanedMappings.length === 0 && orphanedIndexEntries.length === 0) {
      log("\n✅ Nothing to prune.");
      return;
    }

    if (values.verbose) {
      if (orphanedSessions.length > 0) {
        log("\nOrphaned sessions:");
        for (const session of orphanedSessions.slice(0, 10)) {
          log(`  ${session.id} - ${session.threadName || "(no name)"}`);
        }
        if (orphanedSessions.length > 10) {
          log(`  ... and ${orphanedSessions.length - 10} more`);
        }
      }

      if (orphanedMappings.length > 0) {
        log("\nOrphaned mappings:");
        for (const mapping of orphanedMappings.slice(0, 10)) {
          log(`  ${mapping.originalId} -> ${mapping.newId}`);
        }
        if (orphanedMappings.length > 10) {
          log(`  ... and ${orphanedMappings.length - 10} more`);
        }
      }

      if (orphanedIndexEntries.length > 0) {
        log("\nOrphaned index entries:");
        for (const entry of orphanedIndexEntries.slice(0, 10)) {
          log(`  ${entry.id} - ${entry.thread_name || "(no name)"}`);
        }
        if (orphanedIndexEntries.length > 10) {
          log(`  ... and ${orphanedIndexEntries.length - 10} more`);
        }
      }
    }

    if (values["dry-run"]) {
      log("\n(Dry run — no changes were made)");
      return;
    }

    // Confirm before proceeding
    if (!values.yes) {
      const confirm = prompt("\nProceed with pruning? (y/n): ");
      if (confirm?.toLowerCase() !== "y") {
        log("Prune cancelled.");
        process.exit(0);
      }
    }

    // Execute pruning
    log("\nPruning...");

    let deletedSessions = 0;
    let deletedMappings = 0;
    let deletedIndexEntries = 0;

    // Delete orphaned session files
    if (orphanedSessions.length > 0) {
      for (const session of orphanedSessions) {
        try {
          await unlink(session.filePath);
          deletedSessions++;
        } catch (e: any) {
          error(`Failed to delete ${session.filePath}: ${e.message}`);
        }
      }
    }

    // Rewrite mappings file without orphaned entries
    if (orphanedMappings.length > 0) {
      const validMappings = mappings.filter(
        m => allThreadIds.has(m.originalId) || allThreadIds.has(m.newId)
      );
      await rewriteMappingsFile(codexHome, validMappings);
      deletedMappings = orphanedMappings.length;
    }

    // Rewrite session index without orphaned entries
    if (orphanedIndexEntries.length > 0) {
      await rewriteSessionIndex(codexHome, allThreadIds);
      deletedIndexEntries = orphanedIndexEntries.length;
    }

    log("\n" + "=".repeat(50));
    log("Summary:");
    log(`  Sessions deleted:       ${deletedSessions}`);
    log(`  Mappings removed:       ${deletedMappings}`);
    log(`  Index entries removed:  ${deletedIndexEntries}`);
    log("\n✅ Prune complete.");
  } catch (e: any) {
    error(e.message);
    process.exit(1);
  }
}
