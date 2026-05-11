import { parseArgs } from "node:util";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolveCodexHome, getDbPath, getSessionsDir, getSessionIndexPath, getMappingFilePath } from "../config";
import { setVerbose, log } from "../utils";
import { findThreadsByProvider } from "../db";
import { scanJsonlFiles } from "../sessions";
import { loadMappings } from "../mapping";

export async function configCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "codex-home": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
threadctl config — Show configuration and statistics

Usage:
  threadctl config [options]

Options:
  --json                   Output as JSON
  -v, --verbose            Show additional details
  --codex-home <path>      Override Codex data directory (default: ~/.codex)
  -h, --help               Show this help message

Examples:
  # Show configuration
  threadctl config

  # Output as JSON
  threadctl config --json
`);
    process.exit(0);
  }

  setVerbose(values.verbose ?? false);

  try {
    const codexHome = resolveCodexHome(values["codex-home"]);
    const dbPath = getDbPath(codexHome);
    const sessionsDir = getSessionsDir(codexHome);
    const sessionIndexPath = getSessionIndexPath(codexHome);
    const mappingsPath = getMappingFilePath(codexHome);

    // Check existence
    const dbExists = existsSync(dbPath);
    const sessionsDirExists = existsSync(sessionsDir);
    const sessionIndexExists = existsSync(sessionIndexPath);
    const mappingsExists = existsSync(mappingsPath);

    // Gather statistics
    let threadCount = 0;
    let providerCounts: { provider: string; count: number }[] = [];
    let sessionCount = 0;
    let mappingCount = 0;

    if (dbExists) {
      const db = new Database(dbPath, { readonly: true });
      try {
        const result = db.query("SELECT COUNT(*) as count FROM threads").get() as { count: number };
        threadCount = result.count;

        const providers = db.query(
          "SELECT model_provider as provider, COUNT(*) as count FROM threads GROUP BY model_provider ORDER BY count DESC"
        ).all() as { provider: string; count: number }[];
        providerCounts = providers;
      } finally {
        db.close();
      }
    }

    if (sessionsDirExists) {
      const sessions = await scanJsonlFiles(sessionsDir);
      sessionCount = sessions.length;
    }

    if (mappingsExists) {
      const mappings = await loadMappings(codexHome);
      mappingCount = mappings.length;
    }

    // Output
    if (values.json) {
      console.log(
        JSON.stringify(
          {
            codexHome,
            paths: {
              database: { path: dbPath, exists: dbExists },
              sessions: { path: sessionsDir, exists: sessionsDirExists },
              sessionIndex: { path: sessionIndexPath, exists: sessionIndexExists },
              mappings: { path: mappingsPath, exists: mappingsExists },
            },
            statistics: {
              threads: {
                total: threadCount,
                byProvider: providerCounts,
              },
              sessions: sessionCount,
              mappings: mappingCount,
            },
          },
          null,
          2
        )
      );
    } else {
      log("threadctl configuration");
      log("═".repeat(50));
      log("");
      log("Paths:");
      log(`  Codex home:       ${codexHome}`);
      log(`  Database:         ${dbPath} ${dbExists ? "✓" : "✗"}`);
      log(`  Sessions:         ${sessionsDir} ${sessionsDirExists ? "✓" : "✗"}`);
      log(`  Session index:    ${sessionIndexPath} ${sessionIndexExists ? "✓" : "✗"}`);
      log(`  Mappings:         ${mappingsPath} ${mappingsExists ? "✓" : "✗"}`);
      log("");
      log("Statistics:");
      log(`  Total threads:    ${threadCount}`);

      if (providerCounts.length > 0) {
        log("  By provider:");
        for (const { provider, count } of providerCounts) {
          log(`    ${provider.padEnd(20)} ${count}`);
        }
      }

      log(`  Sessions:         ${sessionCount}`);
      log(`  Mappings:         ${mappingCount}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
