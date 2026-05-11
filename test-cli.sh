#!/usr/bin/env bash

echo "Testing threadctl CLI..."
echo "=========================="
echo ""

# Test 1: Main help
echo "Test 1: Main help"
bun src/index.ts
echo ""

# Test 2: Config command help
echo "Test 2: Config command help"
bun src/index.ts config --help
echo ""

# Test 3: Sync command help
echo "Test 3: Sync command help"
bun src/index.ts sync --help
echo ""

# Test 4: Delete command help
echo "Test 4: Delete command help"
bun src/index.ts delete --help
echo ""

# Test 5: Prune command help
echo "Test 5: Prune command help"
bun src/index.ts prune --help
echo ""

# Test 6: Sync command help with options
echo "Test 6: Sync command help with options"
bun src/index.ts sync --from openai --to 9router --help
echo ""

echo "=========================="
echo "All tests completed!"
