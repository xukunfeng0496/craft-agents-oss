#!/bin/bash
# Sync upstream (official GitHub) changes into local main branch,
# then rebase cvte/main on top, and push everything.
set -e

echo "=== Syncing upstream ==="

# 1. Fetch latest from official repo
git fetch upstream

# 2. Update local main to match upstream
git checkout main
git rebase upstream/main
git push origin main
git push github main

# 3. Rebase cvte/main on top of updated main
git checkout cvte/main
git rebase main

# 4. Push to both remotes
git push origin cvte/main --force-with-lease
git push github cvte/main --force-with-lease

echo ""
echo "=== Done ==="
echo "main and cvte/main are up to date with upstream."
