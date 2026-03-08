# Unified Network Interceptor Analysis

## Task
Analyze upstream unified network interceptor refactoring and migration path.

## Context
- Current: copilot-network-interceptor.ts (Copilot-specific)
- Target: unified-network-interceptor.ts (all providers)
- Goal: Cleaner architecture, single interceptor for all LLM providers

## Analysis Steps

### 1. Identify Commits
```bash
cd /Users/kun/code/litchi/craft-agents-oss
git log upstream/main --oneline --all --grep="interceptor\|unified" --since="2024-11-01" > /tmp/interceptor-commits.txt
git log upstream/main --oneline --all -- "**/interceptor*" >> /tmp/interceptor-commits.txt
cat /tmp/interceptor-commits.txt
```

### 2. Compare Implementations
```bash
# Show old copilot-specific interceptor
git show v0.5.5:packages/shared/src/copilot-network-interceptor.ts > /tmp/old-interceptor.ts

# Show new unified interceptor
git show upstream/main:packages/shared/src/unified-network-interceptor.ts > /tmp/new-interceptor.ts

# Compare
diff -u /tmp/old-interceptor.ts /tmp/new-interceptor.ts
```

### 3. Identify Usage Points
```bash
# Where is the old interceptor used?
git grep -n "copilot-network-interceptor" v0.5.5

# Where is the new interceptor used?
git grep -n "unified-network-interceptor" upstream/main
```

### 4. Check Build Script Changes
```bash
# Build scripts that reference interceptor
git diff v0.5.5..upstream/main -- "**/package.json" "**/electron-builder.yml" | grep -A 5 -B 5 "interceptor"
```

### 5. Migration Strategy
- Can both interceptors coexist during migration?
- What's the switch-over point?
- How to test without breaking existing connections?
- Rollback plan if issues found?

## Output Required
1. Commit list
2. Architecture comparison (old vs new)
3. Files to add/remove/modify
4. Migration steps (detailed)
5. Testing strategy (especially for Copilot)
6. Rollback plan
7. Build script changes
8. Estimated effort (hours)

## Deliverable
Create `/tmp/interceptor-analysis.md` with complete findings.
