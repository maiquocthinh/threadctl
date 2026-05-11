# Implementation Summary

## Project: Codex Provider Sync Tool

**Status**: ✅ Complete (with Interactive Mode)

**Date**: 2026-05-11

---

## What Was Built

A CLI tool to sync Codex Desktop threads between model providers by copying SQLite records and JSONL session files, with support for **interactive thread selection**.

### Problem Solved

When using custom providers like `9router` with `wire_api = "responses"`, Codex writes `model_provider = "openai"` instead of the actual provider name, causing threads to not appear when filtering by provider in the UI.

### Solution

The tool creates **copies** (not modifications) of threads with:
- New IDs with `-{provider}` suffix
- Updated `model_provider` field
- All original data preserved
- **Interactive selection** to choose specific threads

---

## Project Structure

```
threadctl/
├── package.json              # Bun project config with bin entry
├── tsconfig.json             # TypeScript config
├── README.md                 # Full documentation
├── QUICKSTART.md             # Quick start guide
├── IMPLEMENTATION.md         # This file
├── test.ts                   # Test script
├── .gitignore                # Git ignore rules
└── src/
    ├── index.ts              # CLI entry point (parseArgs)
    ├── config.ts             # CODEX_HOME resolution
    ├── utils.ts              # ID generation, backup, logger
    ├── db.ts                 # SQLite operations
    ├── sessions.ts           # JSONL file operations
    ├── sync.ts               # Orchestration logic
    └── interactive.ts        # NEW: Interactive thread selection
```

---

## Key Features

### 1. Dynamic Schema Reading
- Reads SQLite schema at runtime
- Copies all columns without hardcoding
- Future-proof against Codex updates

### 2. Interactive Thread Selection (NEW)
- Lists all threads in a formatted table
- Select by number: `1,3,5` or ranges: `1-5`
- Select all: `all`
- Preview before confirming
- Works with dry-run mode

### 3. Flexible Sync Modes
- **Sync all threads**: `sync --from openai --to 9router`
- **Interactive selection**: `sync --from openai --to 9router --interactive`
- **Specific IDs**: `sync --from openai --to 9router --ids "id1,id2"`

### 4. Safety
- **Idempotent**: Running multiple times won't create duplicates
- **Non-destructive**: Only creates new records, never modifies originals
- **Automatic backups**: DB backed up before modifications
- **Dry-run mode**: Preview changes before applying

### 5. Complete Sync
- SQLite `threads` table
- JSONL session files in `sessions/YYYY/MM/DD/`
- Session index (`session_index.jsonl`)

### 6. Other Options
- Bidirectional sync
- Custom Codex home directory
- Verbose logging

---

## Usage Examples

### Basic Usage

```bash
# Sync all threads
threadctl sync --from openai --to 9router

# Interactive selection
threadctl sync --from openai --to 9router --interactive

# Specific thread IDs
threadctl sync --from openai --to 9router --ids "id1,id2,id3"

# Dry-run preview
threadctl sync --from openai --to 9router --interactive --dry-run
```

### Interactive Mode Example

```
$ threadctl sync --from openai --to 9router --interactive

threadctl v1.0.0
══════════════════════════════════════════════════
Codex home: C:\Users\username\.codex

🔍 Interactive Mode
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

Sync: "openai" -> "9router"
──────────────────────────────────────────────────
DB backup: C:\Users\username\.codex\state_5.sqlite.bak-2026-05-11T...
Selected 5 threads to sync
Threads: 5 copied, 0 skipped
Found 5 session files for selected threads
Sessions: 5 copied, 0 skipped
Session index: 5 entries added

══════════════════════════════════════════════════
Summary:
  Threads copied:   5
  Sessions copied:  5
  Index entries:    5

✅ Done.
```

---

## Technical Implementation

### Database Operations (`src/db.ts`)
- `readThreadsSchema()`: Dynamic schema discovery
- `findThreadsByProvider()`: Query threads by provider
- `findThreadsByIds()`: Query specific threads by IDs (NEW)
- `copySpecificThreads()`: Copy selected threads (NEW)
- `copyThreads()`: Transaction-based copying with INSERT OR IGNORE

### Session Operations (`src/sessions.ts`)
- `scanJsonlFiles()`: Recursive directory scan
- `parseSessionMeta()`: Extract metadata from first line
- `findSessionsByProvider()`: Find all sessions for a provider
- `findSessionsByIds()`: Find sessions for specific thread IDs (NEW)
- `copySession()`: String replacement for provider and IDs
- `updateSessionIndex()`: Append new entries

### Interactive Selection (`src/interactive.ts`) - NEW
- `displayThreads()`: Format threads in a table
- `interactiveSelect()`: Interactive CLI for thread selection
  - Supports single numbers: `1,3,5`
  - Supports ranges: `1-5` or `1-3,7-10`
  - Supports `all` to select everything
  - Supports `q` to quit
  - Returns array of selected thread IDs

### Orchestration (`src/sync.ts`)
- Validates input
- Creates backups
- Supports `threadIds` parameter for selective sync (NEW)
- Coordinates DB and file operations
- Supports bidirectional sync
- Returns detailed results

### CLI (`src/index.ts`)
- Argument parsing with `node:util`
- `--interactive` flag for interactive mode (NEW)
- `--ids` flag for specific thread IDs (NEW)
- Help message
- Summary output
- Error handling

---

## New Features Added

### Interactive Thread Selection

**What it does:**
- Lists all threads from source provider in a formatted table
- Shows thread number, ID, name, and last updated time
- Allows user to select specific threads to sync
- Supports flexible selection syntax (numbers, ranges, all)
- Confirms before proceeding with sync

**Why it's useful:**
- Sync only recent threads instead of all historical threads
- Sync only important/active threads
- Preview threads before selecting
- Avoid syncing test/temporary threads

**How to use:**
```bash
# Interactive mode
threadctl sync --from openai --to 9router --interactive

# Interactive + dry-run (preview)
threadctl sync --from openai --to 9router --interactive --dry-run

# Interactive + bidirectional
threadctl sync --from openai --to 9router --interactive --bidirectional
```

### Specific Thread IDs

**What it does:**
- Sync specific threads by providing their IDs directly
- Useful when you know exactly which threads to sync
- Can be combined with other options

**How to use:**
```bash
threadctl sync --from openai --to 9router --ids "id1,id2,id3"
```

---

## Files Created/Updated

- ✅ `package.json` - Project config
- ✅ `tsconfig.json` - TypeScript config
- ✅ `src/config.ts` - Configuration
- ✅ `src/utils.ts` - Utilities
- ✅ `src/db.ts` - Database operations (UPDATED)
- ✅ `src/sessions.ts` - Session file operations (UPDATED)
- ✅ `src/sync.ts` - Orchestration (UPDATED)
- ✅ `src/interactive.ts` - Interactive selection (NEW)
- ✅ `src/index.ts` - CLI entry point (UPDATED)
- ✅ `README.md` - Full documentation (UPDATED)
- ✅ `QUICKSTART.md` - Quick start guide (UPDATED)
- ✅ `test.ts` - Test script
- ✅ `.gitignore` - Git ignore rules

---

## Next Steps for User

1. **Install dependencies**:
   ```bash
   cd D:\Workspace\Backend\Bun\ThreadsSync
   bun install
   ```

2. **Run test**:
   ```bash
   bun test.ts
   ```

3. **Try interactive mode (dry-run)**:
   ```bash
bun run src/index.ts sync --from openai --to 9router --interactive --dry-run
   ```

4. **Actual sync (interactive)**:
   ```bash
   bun run src/index.ts sync --from openai --to 9router --interactive
   ```

5. **Verify in Codex Desktop**:
   - Open Codex Desktop
   - Filter by provider "9router"
   - Threads should appear

6. **Optional - Make globally available**:
   ```bash
   bun link
   threadctl sync --from openai --to 9router --interactive
   ```

---

## Verification Checklist

After running the tool:

- [ ] New threads appear in SQLite with correct `model_provider`
- [ ] New session files created with `-{provider}` suffix
- [ ] Session index updated with new entries
- [ ] Original threads/files unchanged
- [ ] Backup created before DB modification
- [ ] Threads visible in Codex Desktop UI when filtering by provider
- [ ] Re-running tool doesn't create duplicates (idempotent)
- [ ] Interactive mode displays threads correctly
- [ ] Selection syntax works (numbers, ranges, all)
- [ ] Only selected threads are synced

---

**Implementation Complete with Interactive Mode** ✅
