#!/bin/sh
set -e

# Gate 0 — nothing untracked may ship. tools/build_sw.py works from a denylist,
# so any scratch file left in the tree is precached and rsynced to production as
# a public URL. An untracked file is by definition unreviewed; refuse to deploy
# until it is committed or removed.
untracked=$(git status --porcelain --untracked-files=all | grep '^??' || true)
if [ -n "$untracked" ]; then
  echo "✗ refusing to deploy with untracked files:"
  echo "$untracked" | sed 's/^?? /    /'
  echo "  commit them, delete them, or add them to .gitignore."
  exit 1
fi

# Gate 1 — types. tsc emits nothing; it is a linter for JSDoc annotations.
echo "→ type checking"
npm run --silent types

# Gate 2 — unit tests. The numbers are the product, so they are tested.
echo "→ unit tests (node)"
# Bare `node --test` auto-discovers test files and skips node_modules. Passing
# a directory (`node --test tests/`) fails on Node 22+ — it resolves the path
# as a module, not a directory.
node --test

echo "→ unit tests (python)"
(cd tools && python3 -m unittest discover -p 'test_*.py' -q)

# Gate 3 — regenerate the precache manifest and stamp sw.js. Must run after the
# tests and before rsync so the shipped hashes match the shipped bytes.
echo "→ generating service worker manifest"
python3 tools/build_sw.py

# Exclusions live in .deployignore (single source of truth — keep it current).
echo "→ deploying"
rsync -vhrla --exclude-from="$PWD/.deployignore" "$PWD/" vultr:/var/www/thequantitative.com

echo "✓ https://thequantitative.com/"
