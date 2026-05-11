# Changelog - UUID v4 Implementation

## Date: 2026-05-11

## Changes Made

### 1. UUID Generation (`src/utils.ts`)
**Before:**
```typescript
// Appended provider suffix to original ID
return `${originalId}-${targetProvider}`;
// Result: "019d7fa3-be4f-7d42-a1fc-5419c35806ae-9router"
```

**After:**
```typescript
// Generate proper UUID v4
return crypto.randomUUID();
// Result: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

**Why:** 
- Original approach created invalid UUIDs with suffix
- Codex might validate UUID format
- New approach generates proper RFC 4122 UUID v4

### 2. ID Mapping System (`src/mapping.ts` - NEW)
**Purpose:** Track relationship between original and synced thread IDs

**Features:**
- Save mappings to `.threadctl-mappings.jsonl`
- Format: `{originalId, newId, sourceProvider, targetProvider, syncedAt}`
- Query functions: `findOriginalId()`, `isSynced()`
- Persistent across syncs

**Example mapping:**
```json
{
  "originalId": "019d7fa3-be4f-7d42-a1fc-5419c35806ae",
  "newId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sourceProvider": "openai",
  "targetProvider": "9router",
  "syncedAt": "2026-05-11T10:30:00.000Z"
}
```

### 3. Database Operations (`src/db.ts`)
**Changes:**
- `copySpecificThreads()` now returns `mappings` array
- `copyThreads()` now returns `mappings` array
- Mappings created during transaction

### 4. Session Operations (`src/sessions.ts`)
**Changes:**
- `copySession()` now requires `codexHome` parameter
- Loads mappings to find correct new ID
- Warns if no mapping found (shouldn't happen)
- `updateSessionIndex()` uses mappings for new IDs

### 5. Sync Orchestration (`src/sync.ts`)
**Changes:**
- Receives mappings from DB operations
- Saves mappings to file after successful sync
- Passes `codexHome` to `copySession()`

### 6. Documentation Updates
- `README.md` - Explained UUID v4 and mapping file
- `.gitignore` - Added `.threadctl-mappings.jsonl`

## Benefits

### ✅ Proper UUID Format
- Generates RFC 4122 compliant UUID v4
- No validation issues with Codex
- Professional implementation

### ✅ Traceability
- Can trace synced threads back to originals
- Useful for debugging
- Audit trail of all syncs

### ✅ Idempotency
- Check if thread already synced via mapping
- Prevent duplicate syncs
- Safe to run multiple times

### ✅ Clean IDs
- No ugly suffixes like `-9router`
- IDs look native to Codex
- Better user experience

## Migration Notes

**For existing users:**
- Old synced threads (with `-{provider}` suffix) will remain
- New syncs will use UUID v4
- No automatic migration needed
- Can re-sync if desired

**Mapping file location:**
- `~/.codex/.threadctl-mappings.jsonl`
- One line per mapping (JSONL format)
- Append-only (never modified)
- Can be backed up separately

## Testing Checklist

- [ ] Generate new UUID v4 for each thread
- [ ] Save mappings to file
- [ ] Load mappings when copying sessions
- [ ] Use correct new ID in session files
- [ ] Update session index with new IDs
- [ ] Verify threads appear in Codex Desktop
- [ ] Check mapping file format
- [ ] Test idempotency (run twice)

## Files Modified

1. `src/utils.ts` - UUID generation
2. `src/mapping.ts` - NEW: Mapping system
3. `src/db.ts` - Return mappings
4. `src/sessions.ts` - Use mappings
5. `src/sync.ts` - Save mappings
6. `README.md` - Documentation
7. `.gitignore` - Ignore mapping file

## Example Usage

```bash
# Sync with new UUID v4 system
bun run src/index.ts sync --from openai --to 9router --interactive

# Check mappings
cat ~/.codex/.threadctl-mappings.jsonl

# Example output:
# {"originalId":"019d7fa3...","newId":"a1b2c3d4...","sourceProvider":"openai","targetProvider":"9router","syncedAt":"2026-05-11T10:30:00.000Z"}
```

## Summary

Thay đổi từ **ID suffix** (`original-9router`) sang **UUID v4 mới** (`a1b2c3d4-...`) với **mapping file** để trace. Giải pháp chuyên nghiệp hơn, tránh vấn đề validation, và dễ maintain.
