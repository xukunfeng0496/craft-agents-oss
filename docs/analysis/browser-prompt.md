# Browser Automation Tools Analysis

## Task
Analyze upstream browser automation implementation and plan integration strategy.

## Context
- Current: No browser automation in cvte/main
- Target: Add CDP-based browser tools from upstream v0.7.1
- Architecture: Browser pane manager + CDP integration + toolbar preload

## Analysis Steps

### 1. Identify Commits
```bash
cd /Users/kun/code/litchi/craft-agents-oss
git log upstream/main --oneline --all --grep="browser\|Browser\|CDP\|chrome" --since="2024-11-01" > /tmp/browser-commits.txt
git log upstream/main --oneline --all -- "**/browser*" "**/cdp*" >> /tmp/browser-commits.txt
cat /tmp/browser-commits.txt
```

### 2. Analyze Architecture
Key components to understand:
- Browser pane manager (window lifecycle)
- CDP integration (Chrome DevTools Protocol)
- Browser toolbar (separate preload script)
- Element reference system (@e1, @e2)
- Screenshot annotation

### 3. Check Dependencies
```bash
git show upstream/main:apps/electron/package.json | grep -i "chrome\|puppeteer\|cdp"
```

### 4. Identify New Files
```bash
git diff v0.5.5..upstream/main --name-only | grep -i "browser\|cdp"
```

### 5. Integration Points
- How does browser pane integrate with window-manager.ts?
- What IPC channels are needed?
- How does it interact with sessions?
- Build script changes for browser-toolbar preload?

### 6. Security Analysis
- Isolation model for browser pane
- Credential access restrictions
- CSP (Content Security Policy) configuration
- User confirmation requirements

## Output Required
1. Commit list with descriptions
2. Architecture diagram (text-based)
3. New files to add
4. Existing files to modify
5. IPC channel definitions
6. Build script changes
7. Security checklist
8. Testing strategy
9. Estimated effort (hours)

## Deliverable
Create `/tmp/browser-analysis.md` with complete findings.
