# Upstream Feature Analysis - Quick Start

## Overview
This setup uses tmux to run 4 parallel Claude Code agents, each analyzing one feature from the upstream merge plan.

## Files Created

### Analysis Prompts
- `docs/analysis/tiptap-prompt.md` - TipTap editor analysis instructions
- `docs/analysis/browser-prompt.md` - Browser tools analysis instructions
- `docs/analysis/zoom-prompt.md` - Zoom controls analysis instructions
- `docs/analysis/interceptor-prompt.md` - Network interceptor analysis instructions

### Scripts
- `analyze-upstream-features.sh` - Main tmux setup script

## Quick Start

```bash
cd /Users/kun/code/litchi/craft-agents-oss
./analyze-upstream-features.sh
```

This will:
1. Create tmux session "upstream-analysis"
2. Set up 5 windows (4 features + 1 summary)
3. Display analysis prompts in each window
4. Start monitoring dashboard

## Tmux Session Layout

```
Window 0: tiptap       - TipTap Rich Text Editor
Window 1: browser      - Browser Automation Tools
Window 2: zoom         - Image Zoom Controls
Window 3: interceptor  - Unified Network Interceptor
Window 4: summary      - Progress monitoring dashboard
```

Each feature window (0-3) has 2 panes:
- **Top pane**: Analysis prompt + agent workspace
- **Bottom pane**: Quick command reference

## Workflow

### 1. Start the session
```bash
./analyze-upstream-features.sh
```

### 2. Navigate to first feature (Window 0)
- You'll start in Window 0 (tiptap)
- Read the analysis prompt displayed

### 3. Start Claude Code agent
In the top pane, type:
```bash
claude code
```

### 4. Give the agent its task
When the agent starts, paste:
```
Read the analysis prompt in docs/analysis/tiptap-prompt.md and execute all analysis steps. Save results to /tmp/tiptap-analysis.md
```

### 5. Move to next window
Press `Ctrl+B, n` to go to next window (browser)

### 6. Repeat for all features
- Window 1: Browser tools analysis
- Window 2: Zoom controls analysis
- Window 3: Network interceptor analysis

### 7. Monitor progress
Press `Ctrl+B, 4` to jump to summary window
- Shows which analyses are complete
- Updates every 5 seconds

## Tmux Cheat Sheet

| Command | Action |
|---------|--------|
| `Ctrl+B, n` | Next window |
| `Ctrl+B, p` | Previous window |
| `Ctrl+B, 0-4` | Jump to window number |
| `Ctrl+B, o` | Switch between panes (in split windows) |
| `Ctrl+B, [` | Scroll mode (use arrow keys, press `q` to exit) |
| `Ctrl+B, d` | Detach (session keeps running in background) |
| `Ctrl+B, ?` | Show all keybindings |

## Reattach to Session

If you detach or get disconnected:
```bash
tmux attach -t upstream-analysis
```

## View Results

While agents are running or after completion:
```bash
# View individual results
cat /tmp/tiptap-analysis.md
cat /tmp/browser-analysis.md
cat /tmp/zoom-analysis.md
cat /tmp/interceptor-analysis.md

# Check progress
ls -lh /tmp/*-analysis.md

# Watch for updates
watch -n 5 'ls -lh /tmp/*-analysis.md'
```

## Kill Session

When all analyses are complete:
```bash
tmux kill-session -t upstream-analysis
```

## Tips

1. **Parallel execution**: All 4 agents can run simultaneously
2. **Independent work**: Each agent works in isolation
3. **Detach safely**: Press `Ctrl+B, d` to detach - agents keep running
4. **Monitor from outside**: Check `/tmp/*-analysis.md` files anytime
5. **Resume work**: Reattach to continue where you left off

## Expected Outputs

Each analysis should produce:
- Commit list with hashes
- Dependency requirements
- Files to add/modify
- Integration strategy
- Testing checklist
- Effort estimate

## Next Steps

After all analyses complete:
1. Review all 4 analysis files
2. Consolidate findings
3. Update the main plan with detailed implementation steps
4. Begin Phase 1 (TipTap) implementation
