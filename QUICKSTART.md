# Quick Start Guide

## Prerequisites

- Bun runtime installed
- Codex Desktop with existing threads

## Installation

```bash
cd threadctl
bun install
```

## Testing

### 1. Run the test script to verify setup

```bash
bun test.ts
```

Expected output:
```
=== Thread Control - Test Script ===

Codex home: C:\Users\username\.codex
Database: C:\Users\username\.codex\state_5.sqlite

Test 1: Read threads schema
  ✓ Found 15 columns: id, model_provider, thread_name...

Test 2: Count threads by provider
  - openai: 15 threads

Test 3: Find threads for provider "openai"
  ✓ Found 15 threads

Test 4: Scan session files
  ✓ Found 15 session files for "openai"

✓ All tests passed!
```

### 2. Interactive mode (recommended for first use)

```bash
bun run src/index.ts sync --from openai --to 9router --interactive --dry-run
```

This will:
1. Show you all threads from the source provider
2. Let you select which ones to sync
3. Preview what would happen (dry-run)

### 3. Actual sync

After reviewing the dry-run, remove `--dry-run`:

```bash
bun run src/index.ts sync --from openai --to 9router --interactive
```

Or sync all threads:

```bash
bun run src/index.ts sync --from openai --to 9router
```

### 4. Verify in Codex Desktop

1. Open Codex Desktop
2. Filter threads by provider "9router"
3. You should see all synced threads

## Common Workflows

### Workflow 1: Sync specific recent threads

```bash
# Interactive mode - select threads 1-5
bun run src/index.ts sync --from openai --to 9router --interactive
# Enter: 1-5
```

### Workflow 2: Sync all threads

```bash
bun run src/index.ts sync --from openai --to 9router
```

### Workflow 3: Keep two providers in sync

```bash
# First time: sync all
bun run src/index.ts sync --from openai --to 9router --bidirectional

# Later: sync only new threads (interactive)
bun run src/index.ts sync --from openai --to 9router --interactive --bidirectional
```

### Workflow 4: Sync specific threads by ID

```bash
# Get thread IDs from Codex Desktop or interactive mode
bun run src/index.ts sync --from openai --to 9router --ids "thread-id-1,thread-id-2"
```

## Interactive Mode Tips

### Selection Examples

```
Your selection: 1          # Select thread #1
Your selection: 1,3,5      # Select threads 1, 3, and 5
Your selection: 1-5        # Select threads 1 through 5
Your selection: 1-3,7-10   # Select threads 1-3 and 7-10
Your selection: all        # Select all threads
Your selection: q          # Quit without syncing
```

### Combining with Other Options

```bash
# Interactive + dry-run (preview)
bun run src/index.ts sync --from openai --to 9router --interactive --dry-run

# Interactive + verbose (detailed output)
bun run src/index.ts sync --from openai --to 9router --interactive --verbose

# Interactive + bidirectional
bun run src/index.ts sync --from openai --to 9router --interactive --bidirectional
```

## Troubleshooting

### "Database not found"
- Check that `~/.codex/state_5.sqlite` exists
- Use `--codex-home` to specify custom location

### "No threads found"
- Verify provider name matches exactly (case-sensitive)
- Check with: `bun test.ts` to see available providers

### Sessions not appearing
- Restart Codex Desktop to reload session index
- Check that session files were created in `~/.codex/sessions/`

### "Thread already exists" (skipped)
- This is normal - the tool is idempotent
- Already synced threads are automatically skipped

## Rollback

If you need to rollback:

1. Find the backup: `~/.codex/state_5.sqlite.bak-{timestamp}`
2. Stop Codex Desktop
3. Replace current DB with backup:
   ```bash
   cp ~/.codex/state_5.sqlite.bak-{timestamp} ~/.codex/state_5.sqlite
   ```
4. Delete synced session files (they have `-{provider}` suffix)
5. Remove synced entries from `session_index.jsonl`

## Advanced Usage

### Make it globally available

```bash
bun link
```

Then use anywhere:
```bash
threadctl sync --from openai --to 9router --interactive
```

### Custom Codex home

```bash
bun run src/index.ts sync --from openai --to 9router --codex-home /custom/path
```

### Verbose logging

```bash
bun run src/index.ts sync --from openai --to 9router --verbose
```

This shows:
- Column names from schema
- Each thread being copied
- Each session file being processed
- Detailed skip reasons

## Best Practices

1. **Always dry-run first** when syncing many threads:
   ```bash
   threadctl sync --from openai --to 9router --dry-run
   ```

2. **Use interactive mode** for selective syncing:
   ```bash
   threadctl sync --from openai --to 9router --interactive
   ```

3. **Check backups** are created before actual sync

4. **Verify in Codex Desktop** after syncing

5. **Keep backups** for at least a few days in case you need to rollback
