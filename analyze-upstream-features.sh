#!/bin/bash
# Parallel upstream feature analysis using tmux and Claude Code agents
# This script creates a tmux session with 4 windows, each running an analysis agent

set -e

PROJECT_DIR="/Users/kun/code/litchi/craft-agents-oss"
ANALYSIS_DIR="$PROJECT_DIR/docs/analysis"
SESSION_NAME="upstream-analysis"

# Feature configurations
declare -a FEATURES=(
    "tiptap:TipTap Editor:tiptap-prompt.md"
    "browser:Browser Tools:browser-prompt.md"
    "zoom:Zoom Controls:zoom-prompt.md"
    "interceptor:Network Interceptor:interceptor-prompt.md"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Upstream Feature Analysis with Claude Code ===${NC}"
echo "Project: $PROJECT_DIR"
echo "Analysis prompts: $ANALYSIS_DIR"
echo ""

# Check if tmux session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${YELLOW}Session '$SESSION_NAME' already exists.${NC}"
    read -p "Kill and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        tmux kill-session -t "$SESSION_NAME"
        echo -e "${GREEN}Session killed.${NC}"
    else
        echo -e "${BLUE}Attaching to existing session...${NC}"
        tmux attach -t "$SESSION_NAME"
        exit 0
    fi
fi

# Create main tmux session
echo -e "${GREEN}Creating tmux session: $SESSION_NAME${NC}"
tmux new-session -d -s "$SESSION_NAME" -c "$PROJECT_DIR"

# Create window for each feature
WINDOW_NUM=0
for feature_config in "${FEATURES[@]}"; do
    IFS=':' read -r feature_name display_name prompt_file <<< "$feature_config"

    echo -e "${YELLOW}Setting up window $WINDOW_NUM: $display_name${NC}"

    if [ $WINDOW_NUM -eq 0 ]; then
        # Rename first window
        tmux rename-window -t "$SESSION_NAME:0" "$feature_name"
        WINDOW="$SESSION_NAME:0"
    else
        # Create new window
        tmux new-window -t "$SESSION_NAME:$WINDOW_NUM" -n "$feature_name" -c "$PROJECT_DIR"
        WINDOW="$SESSION_NAME:$WINDOW_NUM"
    fi

    # Split window: top for agent output, bottom for commands
    tmux split-window -t "$WINDOW" -v -p 20 -c "$PROJECT_DIR"

    # Top pane: Show prompt and prepare for agent
    tmux select-pane -t "$WINDOW.0"
    tmux send-keys -t "$WINDOW.0" "clear" C-m
    tmux send-keys -t "$WINDOW.0" "echo '=== $display_name Analysis ==='" C-m
    tmux send-keys -t "$WINDOW.0" "echo 'Prompt file: $ANALYSIS_DIR/$prompt_file'" C-m
    tmux send-keys -t "$WINDOW.0" "echo ''" C-m
    tmux send-keys -t "$WINDOW.0" "cat '$ANALYSIS_DIR/$prompt_file'" C-m
    tmux send-keys -t "$WINDOW.0" "echo ''" C-m
    tmux send-keys -t "$WINDOW.0" "echo '--- Ready to start analysis ---'" C-m
    tmux send-keys -t "$WINDOW.0" "echo 'Run: claude code' C-m"

    # Bottom pane: Quick commands
    tmux select-pane -t "$WINDOW.1"
    tmux send-keys -t "$WINDOW.1" "# Quick commands for $display_name analysis" C-m
    tmux send-keys -t "$WINDOW.1" "# View prompt: cat $ANALYSIS_DIR/$prompt_file" C-m
    tmux send-keys -t "$WINDOW.1" "# Start agent: claude code" C-m
    tmux send-keys -t "$WINDOW.1" "# View output: cat /tmp/${feature_name}-analysis.md" C-m

    ((WINDOW_NUM++))
done

# Create summary window
echo -e "${YELLOW}Setting up summary window${NC}"
tmux new-window -t "$SESSION_NAME:$WINDOW_NUM" -n "summary" -c "$PROJECT_DIR"
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "clear" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo '=== Analysis Summary Dashboard ==='" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo ''" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo 'Monitor analysis progress:'" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo ''" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo '1. TipTap Editor     -> /tmp/tiptap-analysis.md'" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo '2. Browser Tools     -> /tmp/browser-analysis.md'" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo '3. Zoom Controls     -> /tmp/zoom-analysis.md'" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo '4. Network Intercept -> /tmp/interceptor-analysis.md'" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo ''" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo 'Watch all outputs:'" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo 'watch -n 5 \"ls -lh /tmp/*-analysis.md 2>/dev/null || echo 'No results yet'\"'" C-m

# Create monitoring script in summary window
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "echo ''" C-m
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "cat > /tmp/monitor-analysis.sh << 'EOF'
#!/bin/bash
while true; do
    clear
    echo \"=== Analysis Progress ===\"
    echo \"\"
    for file in tiptap browser zoom interceptor; do
        if [ -f \"/tmp/\${file}-analysis.md\" ]; then
            size=\$(wc -l < \"/tmp/\${file}-analysis.md\")
            echo \"✓ \${file}: \${size} lines\"
        else
            echo \"⏳ \${file}: pending\"
        fi
    done
    echo \"\"
    echo \"Press Ctrl+C to exit\"
    sleep 5
done
EOF
chmod +x /tmp/monitor-analysis.sh" C-m

echo ""
echo -e "${GREEN}✓ Tmux session created successfully${NC}"
echo ""
echo -e "${BLUE}Session Layout:${NC}"
echo "  Window 0: tiptap       - TipTap editor analysis"
echo "  Window 1: browser      - Browser tools analysis"
echo "  Window 2: zoom         - Zoom controls analysis"
echo "  Window 3: interceptor  - Network interceptor analysis"
echo "  Window 4: summary      - Monitor all analyses"
echo ""
echo -e "${BLUE}Tmux Commands:${NC}"
echo "  Ctrl+B, n              - Next window"
echo "  Ctrl+B, p              - Previous window"
echo "  Ctrl+B, 0-4            - Jump to window"
echo "  Ctrl+B, o              - Switch pane (in split windows)"
echo "  Ctrl+B, d              - Detach (session keeps running)"
echo "  Ctrl+B, [              - Scroll mode (q to exit)"
echo ""
echo -e "${BLUE}Workflow:${NC}"
echo "  1. Navigate to each window (0-3)"
echo "  2. In top pane, type: claude code"
echo "  3. Paste the analysis prompt when agent starts"
echo "  4. Monitor progress in window 4 (summary)"
echo "  5. Results saved to /tmp/*-analysis.md"
echo ""
echo -e "${YELLOW}Starting monitoring in summary window...${NC}"
tmux send-keys -t "$SESSION_NAME:$WINDOW_NUM" "/tmp/monitor-analysis.sh" C-m

echo -e "${GREEN}Attaching to session...${NC}"
sleep 1
tmux attach -t "$SESSION_NAME"
