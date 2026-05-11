import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { getMappingFilePath } from "./config";

export interface SyncMapping {
  originalId: string;
  newId: string;
  sourceProvider: string;
  targetProvider: string;
  syncedAt: string;
}

/**
 * Load all sync mappings from file.
 */
export async function loadMappings(codexHome: string): Promise<SyncMapping[]> {
  const filePath = getMappingFilePath(codexHome);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Save a new sync mapping.
 */
export async function saveMappings(
  codexHome: string,
  mappings: SyncMapping[]
): Promise<void> {
  const filePath = getMappingFilePath(codexHome);

  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const lines = mappings.map((m) => JSON.stringify(m)).join("\n");
  await writeFile(filePath, lines + "\n", { flag: "a" });
}

/**
 * Find the original ID for a synced thread.
 */
export async function findOriginalId(
  codexHome: string,
  syncedId: string
): Promise<string | null> {
  const mappings = await loadMappings(codexHome);
  const mapping = mappings.find((m) => m.newId === syncedId);
  return mapping ? mapping.originalId : null;
}

/**
 * Check if a thread has already been synced.
 */
export async function isSynced(
  codexHome: string,
  originalId: string,
  targetProvider: string
): Promise<boolean> {
  const mappings = await loadMappings(codexHome);
  return mappings.some(
    (m) => m.originalId === originalId && m.targetProvider === targetProvider
  );
}
