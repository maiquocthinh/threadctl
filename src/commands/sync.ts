import { parseArgs } from "node:util";
import { sync } from "../sync";
import { interactiveSelect } from "../interactive";
import { resolveCodexHome } from "../config";
import { setVerbose, log, error } from "../utils";

export async function syncCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: "string", short: "f" },
      to: { type: "string", short: "t" },
      "dry-run": { type: "boolean", short: "d", default: false },
      bidirectional: { type: "boolean", short: "b", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "codex-home": { type: "string" },
      interactive: { type: "boolean", short: "i", default: false },
      ids: { type: "string" }, // Comma-separated thread IDs
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help || !values.from || !values.to) {
    console.log(`
threadctl sync — Sync Codex threads between model providers

Usage:
  threadctl sync --from <provider> --to <provider> [options]

Options:
  -f, --from <provider>       Source provider (e.g., "openai")
  -t, --to <provider>         Target provider (e.g., "9router")
  -i, --interactive           Interactive mode: select specific threads to sync
      --ids <id1,id2,...>     Sync specific thread IDs (comma-separated)
  -d, --dry-run               Preview changes without modifying anything
  -b, --bidirectional         Sync in both directions
  -v, --verbose               Show detailed progress
      --codex-home <path>     Override Codex data directory (default: ~/.codex)
  -h, --help                  Show this help message

Examples:
  # Sync all threads
  threadctl sync --from openai --to 9router

  # Interactive selection
  threadctl sync --from openai --to 9router --interactive

  # Sync specific threads by ID
  threadctl sync --from openai --to 9router --ids "019d7fa3-be4f-7d42-a1fc-5419c35806ae"

  # Dry-run with interactive selection
  threadctl sync --from openai --to 9router --interactive --dry-run

  # Bidirectional sync
  threadctl sync --from 9router --to anthropic --bidirectional
`);
    process.exit(values.help ? 0 : 1);
  }

  setVerbose(values.verbose ?? false);

  log("threadctl v1.0.0");
  log("=".repeat(50));

  try {
    const codexHome = resolveCodexHome(values["codex-home"]);
    let threadIds: string[] | undefined;

    // Interactive mode
    if (values.interactive) {
      log("\n🔍 Interactive Mode");
      threadIds = await interactiveSelect(codexHome, values.from);

      if (threadIds.length === 0) {
        log("\nNo threads selected. Exiting.");
        process.exit(0);
      }

      // Confirm before proceeding
      const confirm = prompt("\nProceed with sync? (y/n): ");
      if (confirm?.toLowerCase() !== "y") {
        log("Sync cancelled.");
        process.exit(0);
      }
    }
    // Specific IDs provided
    else if (values.ids) {
      threadIds = values.ids.split(",").map((id) => id.trim()).filter(Boolean);
      log(`\nSyncing ${threadIds.length} specific thread(s)`);
    }

    const results = await sync({
      from: values.from,
      to: values.to,
      dryRun: values["dry-run"] ?? false,
      bidirectional: values.bidirectional ?? false,
      codexHome: values["codex-home"],
      threadIds,
    });

    log("\n" + "=".repeat(50));
    log("Summary:");

    let totalThreads = 0;
    let totalSessions = 0;
    let totalIndex = 0;

    for (const r of results) {
      totalThreads += r.threadsCopied;
      totalSessions += r.sessionsCopied;
      totalIndex += r.indexEntriesAdded;
    }

    log(`  Threads copied:   ${totalThreads}`);
    log(`  Sessions copied:  ${totalSessions}`);
    log(`  Index entries:    ${totalIndex}`);

    if (values["dry-run"]) {
      log("\n(Dry run — no changes were made)");
    }

    log("\n✅ Done.");
  } catch (e: any) {
    error(e.message);
    process.exit(1);
  }
}
