#!/bin/bash
# Quick launcher for individual feature analysis (without tmux)
# Usage: ./analyze-feature.sh [tiptap|browser|zoom|interceptor]

set -e

FEATURE=$1
PROJECT_DIR="/Users/kun/code/litchi/craft-agents-oss"
ANALYSIS_DIR="$PROJECT_DIR/docs/analysis"

if [ -z "$FEATURE" ]; then
    echo "Usage: $0 [tiptap|browser|zoom|interceptor]"
    echo ""
    echo "Available features:"
    echo "  tiptap       - TipTap Rich Text Editor"
    echo "  browser      - Browser Automation Tools"
    echo "  zoom         - Image Zoom Controls"
    echo "  interceptor  - Unified Network Interceptor"
    exit 1
fi

case $FEATURE in
    tiptap)
        PROMPT_FILE="tiptap-prompt.md"
        OUTPUT_FILE="/tmp/tiptap-analysis.md"
        ;;
    browser)
        PROMPT_FILE="browser-prompt.md"
        OUTPUT_FILE="/tmp/browser-analysis.md"
        ;;
    zoom)
        PROMPT_FILE="zoom-prompt.md"
        OUTPUT_FILE="/tmp/zoom-analysis.md"
        ;;
    interceptor)
        PROMPT_FILE="interceptor-prompt.md"
        OUTPUT_FILE="/tmp/interceptor-analysis.md"
        ;;
    *)
        echo "Error: Unknown feature '$FEATURE'"
        exit 1
        ;;
esac

echo "=== $FEATURE Analysis ==="
echo "Prompt: $ANALYSIS_DIR/$PROMPT_FILE"
echo "Output: $OUTPUT_FILE"
echo ""
echo "--- Analysis Instructions ---"
cat "$ANALYSIS_DIR/$PROMPT_FILE"
echo ""
echo "--- Ready to Start ---"
echo "Starting Claude Code agent..."
echo ""

cd "$PROJECT_DIR"
exec claude code
