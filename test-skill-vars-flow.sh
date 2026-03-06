#!/bin/bash
# Test script for skill variables flow

set -e

WORKSPACE_ID="my-workspace"
SKILL_SLUG="test-vars"
WORKSPACE_ROOT="$HOME/.craft-agent/workspaces/$WORKSPACE_ID"

echo "=== Skill Variables Flow Test ==="
echo ""

# 1. Check if skill exists
echo "1. Checking if skill exists..."
if [ ! -f "$WORKSPACE_ROOT/skills/$SKILL_SLUG/SKILL.md" ]; then
    echo "❌ Skill not found at: $WORKSPACE_ROOT/skills/$SKILL_SLUG/SKILL.md"
    exit 1
fi
echo "✓ Skill found"
echo ""

# 2. Show original skill content (first 10 lines)
echo "2. Original SKILL.md content (first 10 lines):"
head -10 "$WORKSPACE_ROOT/skills/$SKILL_SLUG/SKILL.md"
echo ""

# 3. Check for placeholders in original
echo "3. Placeholders in original SKILL.md:"
grep -o '{{[A-Z_][A-Z0-9_]*}}' "$WORKSPACE_ROOT/skills/$SKILL_SLUG/SKILL.md" | sort -u
echo ""

# 4. Check latest overlay
echo "4. Checking latest overlay directory..."
LATEST_OVERLAY=$(ls -td /var/folders/*/T/wa-skill-vars-* 2>/dev/null | head -1)
if [ -z "$LATEST_OVERLAY" ]; then
    echo "⚠️  No overlay directory found"
else
    echo "✓ Latest overlay: $LATEST_OVERLAY"

    if [ -f "$LATEST_OVERLAY/skills/$SKILL_SLUG/SKILL.md" ]; then
        echo ""
        echo "5. Overlay SKILL.md content (first 10 lines):"
        head -10 "$LATEST_OVERLAY/skills/$SKILL_SLUG/SKILL.md"
        echo ""

        echo "6. Checking for remaining placeholders in overlay:"
        REMAINING=$(grep -o '{{[A-Z_][A-Z0-9_]*}}' "$LATEST_OVERLAY/skills/$SKILL_SLUG/SKILL.md" 2>/dev/null || echo "")
        if [ -z "$REMAINING" ]; then
            echo "✅ No placeholders found - substitution successful!"
        else
            echo "⚠️  Remaining placeholders:"
            echo "$REMAINING" | sort -u
        fi
    else
        echo "⚠️  Skill not found in overlay"
    fi
fi

echo ""
echo "=== Test Complete ==="
