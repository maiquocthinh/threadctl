import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { basename, win32 } from "node:path";
import { resolveCodexHome, getDbPath, getSessionIndexPath } from "./config";
import { findThreadsByProvider, type ThreadRow } from "./db";
import { log, error } from "./utils";

interface ThreadWithName extends ThreadRow {
  displayName?: string;
}

function getThreadDisplayName(thread: ThreadWithName): string {
  return thread.displayName || thread.title || thread.thread_name || "Untitled";
}

/**
 * Load thread names from session_index.jsonl
 */
function loadThreadNames(codexHome: string): Map<string, string> {
  const indexPath = getSessionIndexPath(codexHome);
  const names = new Map<string, string>();

  if (!existsSync(indexPath)) {
    return names;
  }

  try {
    const content = readFileSync(indexPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id && entry.thread_name) {
          names.set(entry.id, entry.thread_name);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore read errors
  }

  return names;
}

/**
 * Display threads in a formatted table.
 */
function displayThreads(threads: ThreadWithName[]) {
  const groups = groupThreadsByProject(threads);
  let rowIndex = 0;

  for (const [project, projectThreads] of groups) {
    console.log(`\nThread workspace: ${project} (${projectThreads.length})`);
    console.log("┌─────┬──────────────────────────────────────┬─────────────────────────────────────────────────┬─────────────────────┐");
    console.log("│ No. │ ID                                   │ Thread Name                                     │ Updated At          │");
    console.log("├─────┼──────────────────────────────────────┼─────────────────────────────────────────────────┼─────────────────────┤");

    for (const thread of projectThreads) {
      rowIndex++;
      const num = String(rowIndex).padEnd(3);
      const id = String(thread.id).substring(0, 36).padEnd(36);
      const name = String(getThreadDisplayName(thread)).substring(0, 47).padEnd(47);
      const updated = formatUpdatedAt(thread.updated_at);

      console.log(`│ ${num} │ ${id} │ ${name} │ ${updated} │`);
    }

    console.log("└─────┴──────────────────────────────────────┴─────────────────────────────────────────────────┴─────────────────────┘");
  }
}

function groupThreadsByProject(threads: ThreadWithName[]): Map<string, ThreadWithName[]> {
  const groups = new Map<string, ThreadWithName[]>();

  for (const thread of threads) {
    const project = getProjectName(thread.cwd);
    const group = groups.get(project) ?? [];
    group.push(thread);
    groups.set(project, group);
  }

  return groups;
}

function getProjectName(cwd: unknown): string {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    return "(no project)";
  }

  const normalized = cwd.replace(/^\\\\\?\\/, "");
  const projectName = normalized.includes("\\")
    ? win32.basename(normalized)
    : basename(normalized);

  return projectName || normalized || "(no project)";
}

function formatUpdatedAt(value: unknown): string {
  let updated = "N/A".padEnd(19);
  if (!value) return updated;

  try {
    let date: Date;

    if (typeof value === "string") {
      date = new Date(value);
    } else if (typeof value === "number") {
      const timestamp = value < 100000000000 ? value * 1000 : value;
      date = new Date(timestamp);
    } else {
      return updated;
    }

    if (!isNaN(date.getTime())) {
      updated = date.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).substring(0, 19).padEnd(19);
    }
  } catch {
    updated = "N/A".padEnd(19);
  }

  return updated;
}

export function selectThreadIds(
  codexHome: string,
  threads: ThreadRow[],
  action: string
): string[] {
  if (threads.length === 0) {
    return [];
  }

  // Load thread names from session_index.jsonl
  const threadNames = loadThreadNames(codexHome);

  // Merge thread names
  const threadsWithNames: ThreadWithName[] = threads.map(t => ({
    ...t,
    displayName: threadNames.get(t.id) || t.title || t.thread_name
  }));

  // Build display-order array matching grouped table output
  const groups = groupThreadsByProject(threadsWithNames);
  const displayOrder: ThreadWithName[] = [];
  for (const [, projectThreads] of groups) {
    displayOrder.push(...projectThreads);
  }

  displayThreads(threadsWithNames);

  console.log(`\nSelect threads to ${action}:`);
  console.log("  - Enter numbers separated by commas (e.g., 1,3,5)");
  console.log("  - Enter ranges with dash (e.g., 1-5)");
  console.log("  - Enter 'all' to select all threads");
  console.log("  - Enter 'q' to quit");

  const input = prompt("\nYour selection: ");

  if (!input || input.trim().toLowerCase() === "q") {
    log("Selection cancelled.");
    return [];
  }

  if (input.trim().toLowerCase() === "all") {
    const selectedIds = displayOrder.map((t) => t.id);
    logSelectedThreads(selectedIds, displayOrder);
    return selectedIds;
  }

  // Parse selection
  const selected = new Set<number>();
  const parts = input.split(",").map((s) => s.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n.trim()));
      if (isNaN(start) || isNaN(end) || start < 1 || end > displayOrder.length) {
        error(`Invalid range: ${part}`);
        continue;
      }
      for (let i = start; i <= end; i++) {
        selected.add(i);
      }
    } else {
      const num = parseInt(part);
      if (isNaN(num) || num < 1 || num > displayOrder.length) {
        error(`Invalid number: ${part}`);
        continue;
      }
      selected.add(num);
    }
  }

  const selectedIds = Array.from(selected)
    .sort((a, b) => a - b)
    .map((num) => displayOrder[num - 1].id);

  if (selectedIds.length === 0) {
    log("No valid threads selected.");
    return [];
  }

  logSelectedThreads(selectedIds, displayOrder);

  return selectedIds;
}

/**
 * Interactive mode: list threads and let user select which ones to sync.
 */
export async function interactiveSelect(
  codexHome: string,
  provider: string
): Promise<string[]> {
  const dbPath = getDbPath(codexHome);
  const db = new Database(dbPath, { readonly: true });

  let threads: ThreadRow[];
  try {
    threads = findThreadsByProvider(db, provider);
  } finally {
    db.close();
  }

  if (threads.length === 0) {
    log(`No threads found with model_provider="${provider}"`);
    return [];
  }

  log(`Found ${threads.length} threads with model_provider="${provider}"`);
  return selectThreadIds(codexHome, threads, "sync");
}

function logSelectedThreads(selectedIds: string[], threadsWithNames: ThreadWithName[]) {
  log(`\nSelected ${selectedIds.length} thread(s):`);
  selectedIds.forEach((id, idx) => {
    const thread = threadsWithNames.find((t) => t.id === id);
    const name = thread ? getThreadDisplayName(thread) : "Untitled";
    console.log(`  ${idx + 1}. ${name} (${id.substring(0, 8)}...)`);
  });
}
