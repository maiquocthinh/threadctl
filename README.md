# Thread Control

Sync and manage Codex Desktop threads between model providers.

## Problem

When using custom providers like `9router` with `wire_api = "responses"`, Codex writes `model_provider = "openai"` instead of `"9router"`, causing threads to not appear when filtering by provider in the UI.

## Solution

This tool copies threads from one provider to another, creating new records with:
- **New UUID v4 IDs** (proper random UUIDs, not suffixed)
- Updated `model_provider` field
- All original data preserved
- **ID mapping file** (`.threadctl-mappings.jsonl`) to trace original → new ID relationships

## Installation

```bash
bun install
```

## Commands

### sync - Sync threads between providers

```bash
# Basic sync
threadctl sync --from openai --to 9router

# Dry run (preview without changes)
threadctl sync --from openai --to 9router --dry-run

# Bidirectional sync
threadctl sync --from 9router --to anthropic --bidirectional
```

**Interactive Mode (Select Specific Threads)**

```bash
threadctl sync --from openai --to 9router --interactive
```

This will:
1. List all threads from the source provider in a table
2. Let you select specific threads by number
3. Confirm before syncing

**Selection syntax:**
- Single: `1` or `3,5,7`
- Range: `1-5` or `1-3,7-10`
- All: `all`
- Quit: `q`

**Example:**
```
Found 15 threads with model_provider="openai"

┌─────┬──────────────────────────────────────┬─────────────────────────────────────────────────┬─────────────────────┐
│ No. │ ID                                   │ Thread Name                                     │ Updated At          │
├─────┼──────────────────────────────────────┼─────────────────────────────────────────────────┼─────────────────────┤
│ 1   │ 019d7fa3-be4f-7d42-a1fc-5419c35806ae │ Giải nén và tổng quan dự án                    │ 2026-04-12 03:02:19 │
│ 2   │ 019d7fc0-ef63-7563-aa33-15a5a87c3591 │ Start Project                                   │ 2026-04-12 03:44:45 │
│ 3   │ 019dc80b-881b-7071-bfd7-fc26479d5020 │ Xem tiến độ dự án                              │ 2026-04-26 04:28:44 │
...

Select threads to sync:
  - Enter numbers separated by commas (e.g., 1,3,5)
  - Enter ranges with dash (e.g., 1-5)
  - Enter 'all' to select all threads
  - Enter 'q' to quit

Your selection: 1,3,5-7

Selected 5 thread(s):
  1. Giải nén và tổng quan dự án (019d7fa3...)
  2. Xem tiến độ dự án (019dc80b...)
  3. Check out S01-T02 (019dd8e3...)
  4. Xác định bước tiếp theo (019ddc9d...)
  5. Bắt đầu task tiếp theo (019dde82...)

Proceed with sync? (y/n): y
```

**Sync Specific Thread IDs**

```bash
threadctl sync --from openai --to 9router --ids "019d7fa3-be4f-7d42-a1fc-5419c35806ae,019d7fc0-ef63-7563-aa33-15a5a87c3591"
```

**Options**

- `-f, --from <provider>` - Source provider (required)
- `-t, --to <provider>` - Target provider (required)
- `-i, --interactive` - Interactive mode: select specific threads
- `--ids <id1,id2,...>` - Sync specific thread IDs (comma-separated)
- `-d, --dry-run` - Preview changes without modifying anything
- `-b, --bidirectional` - Sync in both directions
- `-v, --verbose` - Show detailed progress
- `--codex-home <path>` - Override Codex data directory (default: `~/.codex`)
- `-h, --help` - Show help message

### delete - Delete threads and associated files

Delete threads from database along with their session files, index entries, and mappings.

```bash
# Delete single thread
threadctl delete --id "019d7fa3-be4f-7d42-a1fc-5419c35806ae"

# Delete multiple threads
threadctl delete --ids "id1,id2,id3"

# Delete all threads from a provider (with dry-run)
threadctl delete --provider openai --dry-run

# Select provider threads interactively
threadctl delete --provider openai --interactive

# Delete without confirmation
threadctl delete --provider openai --yes

# Keep session files (only delete from database)
threadctl delete --provider openai --keep-sessions
```

**Options**

- `--id <thread-id>` - Delete single thread
- `--ids <id1,id2,...>` - Delete multiple threads (comma-separated)
- `--provider <provider>` - Delete all threads from provider
- `-i, --interactive` - Select provider threads interactively
- `-d, --dry-run` - Preview deletion without making changes
- `-y, --yes` - Skip confirmation prompt
- `--keep-sessions` - Don't delete session files
- `--keep-mappings` - Don't clean up mappings
- `-v, --verbose` - Show detailed progress
- `-h, --help` - Show help message

### prune - Clean up orphaned files

Remove orphaned session files, mappings, and index entries that reference non-existent threads.

```bash
# Preview what would be pruned
threadctl prune --dry-run

# Prune with confirmation
threadctl prune

# Prune without confirmation
threadctl prune --yes

# Only prune session files
threadctl prune --sessions-only

# Only prune mappings
threadctl prune --mappings-only
```

**Options**

- `-d, --dry-run` - Preview pruning without making changes
- `-y, --yes` - Skip confirmation prompt
- `--sessions-only` - Only prune session files
- `--mappings-only` - Only prune mappings
- `-v, --verbose` - Show detailed progress
- `-h, --help` - Show help message

### config - Show configuration and statistics

Display Codex home path, file locations, and statistics about threads, sessions, and mappings.

```bash
# Show configuration
threadctl config

# Output as JSON
threadctl config --json

# Verbose output
threadctl config --verbose
```

**Options**

- `--json` - Output as JSON
- `-v, --verbose` - Show additional details
- `-h, --help` - Show help message

## What it does

1. **SQLite Database** (`state_5.sqlite`):
   - Reads schema dynamically
   - Generates new UUID v4 for each copied thread
   - Copies threads with new IDs and target provider
   - Creates backup before modifications

2. **ID Mapping** (`.threadctl-mappings.jsonl`):
   - Saves mapping: original ID → new ID
   - Allows tracing synced threads back to originals
   - Used to ensure sessions get correct new IDs

3. **JSONL Session Files** (`sessions/**/*.jsonl`):
   - Scans all session files
   - Replaces `model_provider` and session IDs using mapping
   - Creates new files with `-{provider}` suffix

4. **Session Index** (`session_index.jsonl`):
   - Appends new entries for synced sessions with new UUIDs

## Safety

- **Idempotent**: Running multiple times won't create duplicates
- **Non-destructive**: Only creates new records, never modifies originals
- **Automatic backups**: DB is backed up before modifications
- **Dry-run mode**: Preview changes before applying
- **Interactive selection**: Choose exactly which threads to sync

## Use Cases

### Sync threads between providers
```bash
threadctl sync --from openai --to 9router
```

### Preview what would be synced
```bash
threadctl sync --from openai --to 9router --dry-run --verbose
```

### Sync only recent threads (interactive)
```bash
threadctl sync --from openai --to 9router --interactive
# Then select: 1-10
```

### Sync specific important threads
```bash
threadctl sync --from openai --to 9router --ids "thread-id-1,thread-id-2"
```

### Keep two providers in sync
```bash
threadctl sync --from openai --to 9router --bidirectional
```

### Delete old threads
```bash
# Preview deletion
threadctl delete --provider old-provider --dry-run

# Select threads to delete
threadctl delete --provider old-provider --interactive

# Delete with confirmation
threadctl delete --provider old-provider
```

### Clean up orphaned files
```bash
# Preview what would be cleaned
threadctl prune --dry-run

# Clean up orphaned files
threadctl prune
```

### Check configuration
```bash
# Show paths and statistics
threadctl config

# Get JSON output
threadctl config --json
```

## Example Output

```bash
$ threadctl sync --from openai --to 9router --interactive

threadctl v1.0.0
══════════════════════════════════════════════════
Codex home: C:\Users\username\.codex

🔍 Interactive Mode
Found 15 threads with model_provider="openai"

[Table showing threads...]

Your selection: 1,3,5

Selected 3 thread(s):
  1. Giải nén và tổng quan dự án (019d7fa3...)
  2. Xem tiến độ dự án (019dc80b...)
  3. Check out S01-T02 (019dd8e3...)

Proceed with sync? (y/n): y

Sync: "openai" -> "9router"
──────────────────────────────────────────────────
DB backup: C:\Users\username\.codex\state_5.sqlite.bak-2026-05-11T...
Selected 3 threads to sync
Threads: 3 copied, 0 skipped
Found 3 session files for selected threads
Sessions: 3 copied, 0 skipped
Session index: 3 entries added

══════════════════════════════════════════════════
Summary:
  Threads copied:   3
  Sessions copied:  3
  Index entries:    3

✅ Done.
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Database**: `bun:sqlite` (built-in)
- **File I/O**: `node:fs/promises`

## License

MIT
