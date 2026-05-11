#!/usr/bin/env bun
/**
 * Simple test script to verify the tool works correctly.
 * Run: bun test.ts
 */

import { Database } from "bun:sqlite";
import { resolveCodexHome, getDbPath } from "./src/config";
import { readThreadsSchema, findThreadsByProvider } from "./src/db";
import { findSessionsByProvider } from "./src/sessions";

console.log("=== Thread Control - Test Script ===\n");

const codexHome = resolveCodexHome();
console.log(`Codex home: ${codexHome}`);

const dbPath = getDbPath(codexHome);
console.log(`Database: ${dbPath}\n`);

try {
  const db = new Database(dbPath, { readonly: true });

  // Test 1: Read schema
  console.log("Test 1: Read threads schema");
  const columns = readThreadsSchema(db);
  console.log(`  ✓ Found ${columns.length} columns: ${columns.slice(0, 5).join(", ")}...\n`);

  // Test 2: Count threads by provider
  console.log("Test 2: Count threads by provider");
  const providers = db
    .query("SELECT model_provider, COUNT(*) as count FROM threads GROUP BY model_provider")
    .all() as { model_provider: string; count: number }[];

  for (const p of providers) {
    console.log(`  - ${p.model_provider}: ${p.count} threads`);
  }
  console.log();

  // Test 3: Find threads for a specific provider
  if (providers.length > 0) {
    const testProvider = providers[0].model_provider;
    console.log(`Test 3: Find threads for provider "${testProvider}"`);
    const threads = findThreadsByProvider(db, testProvider);
    console.log(`  ✓ Found ${threads.length} threads\n`);
  }

  db.close();

  // Test 4: Find session files
  console.log("Test 4: Scan session files");
  if (providers.length > 0) {
    const testProvider = providers[0].model_provider;
    const sessions = await findSessionsByProvider(codexHome, testProvider);
    console.log(`  ✓ Found ${sessions.length} session files for "${testProvider}"\n`);
  }

  console.log("✓ All tests passed!");
  console.log("\nReady to run:");
  console.log("  bun run src/index.ts sync --from openai --to 9router --dry-run");
} catch (e: any) {
  console.error("✗ Test failed:", e.message);
  process.exit(1);
}
