import { parseArgs } from "node:util";

/**
 * CLI router for subcommands.
 */
export async function runCli(argv: string[]) {
  const firstArg = argv[0];

  if (firstArg === "--help" || firstArg === "-h") {
    showHelp();
    process.exit(0);
  }

  // Keep direct --from usage working for existing installs.
  const hasFromFlag = argv.includes("--from") || argv.includes("-f");
  const isSubcommand = ["sync", "delete", "prune", "config"].includes(firstArg);

  if (hasFromFlag && !isSubcommand) {
    const { syncCommand } = await import("./commands/sync");
    return await syncCommand(argv);
  }

  // New subcommand mode
  if (isSubcommand) {
    const subcommand = argv[0];
    const subcommandArgs = argv.slice(1);

    switch (subcommand) {
      case "sync": {
        const { syncCommand } = await import("./commands/sync");
        return await syncCommand(subcommandArgs);
      }
      case "delete": {
        const { deleteCommand } = await import("./commands/delete");
        return await deleteCommand(subcommandArgs);
      }
      case "prune": {
        const { pruneCommand } = await import("./commands/prune");
        return await pruneCommand(subcommandArgs);
      }
      case "config": {
        const { configCommand } = await import("./commands/config");
        return await configCommand(subcommandArgs);
      }
    }
  }

  // No valid command found, show help
  showHelp();
  process.exit(1);
}

function showHelp() {
  console.log(`
threadctl — Sync and manage Codex threads between model providers

Usage:
  threadctl <command> [options]

Commands:
  sync      Sync threads between providers
  delete    Delete threads and associated files
  prune     Clean up orphaned files
  config    Show configuration and statistics

Global Options:
  --codex-home <path>     Override Codex data directory (default: ~/.codex)
  -v, --verbose           Show detailed progress
  -h, --help              Show help message

Examples:
  # Sync all threads
  threadctl sync --from openai --to 9router

  # Delete threads by provider
  threadctl delete --provider openai --dry-run

  # Clean up orphaned files
  threadctl prune --dry-run

  # Show configuration
  threadctl config

Run 'threadctl <command> --help' for more information on a command.
`);
}
