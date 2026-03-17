# Agent Power Benchmark

This document describes a repeatable way to compare agent-runtime cost before and after a change.

## What to measure

Use two layers of evidence:

1. App-level process cost
   - Average CPU
   - Peak CPU
   - Average RSS memory
   - Peak RSS memory

2. System-level energy evidence on macOS
   - `powermetrics` per-process energy impact
   - CPU / GPU / package power summaries

The app-level numbers are easy to compare across runs. `powermetrics` is the stronger energy signal.

The benchmark CSV now also includes per-group breakdowns for:

- `main`
- `renderer`
- `gpu`
- `utility`
- `claude_sdk`
- `codex`
- `copilot`
- `other`

This makes it possible to separate renderer cost from agent/backend subprocess cost.

## Keep the scenario fixed

For a valid before/after comparison, keep these constant:

- Same machine
- Same power mode and charger state
- Same window layout and size
- Same model / provider
- Same workspace and repo state
- Same prompt
- Same benchmark duration
- Similar warm-up state

Recommended prompt pattern:

```text
Scan this repo, inspect at least 8 files across renderer and main process, explain the app architecture, identify performance bottlenecks, and propose a concrete refactor plan with code-level reasoning.
```

This keeps the agent active long enough to exercise streaming, turn grouping, markdown rendering, and tool activity UI.

## Before / After workflow

Use one run on the baseline commit and one run on the optimized commit.

### 1. Launch the app

From repo root:

```bash
bun run electron:start
```

When running from source, the app already enables debug logging automatically. Do not pass `--debug` here, because Electron treats it as a deprecated Node debug flag.

### 2. Find the Electron root PID

In another terminal:

```bash
pgrep -fal 'Work Agents|Electron'
```

If multiple processes match, pick the main app/root Electron process.

### 3. Collect app-level samples

Run the benchmark sampler for 180 seconds:

```bash
./scripts/benchmark-electron-process.sh collect --pid <ROOT_PID> --duration 180 --interval 1 --output /tmp/work-agent-before.csv
```

Or let the script auto-match:

```bash
./scripts/benchmark-electron-process.sh collect --match 'Work Agents|Electron' --duration 180 --interval 1 --output /tmp/work-agent-before.csv
```

Immediately after starting the sampler, trigger the benchmark prompt in the app.

### 4. Optional: collect system energy evidence

This requires `sudo` on macOS:

```bash
sudo powermetrics \
  --samplers tasks,cpu_power,gpu_power \
  --show-process-energy \
  --show-usage-summary \
  --sample-rate 1000 \
  --sample-count 180 \
  --output-file /tmp/work-agent-before.powermetrics.txt
```

Start this at the same time as the CPU sampler, then run the same prompt.

### 5. Repeat on the optimized build

Collect a second run:

```bash
./scripts/benchmark-electron-process.sh collect --pid <ROOT_PID> --duration 180 --interval 1 --output /tmp/work-agent-after.csv
```

And optionally:

```bash
sudo powermetrics \
  --samplers tasks,cpu_power,gpu_power \
  --show-process-energy \
  --show-usage-summary \
  --sample-rate 1000 \
  --sample-count 180 \
  --output-file /tmp/work-agent-after.powermetrics.txt
```

### 6. Compare the CSV summaries

```bash
./scripts/benchmark-electron-process.sh compare /tmp/work-agent-before.csv /tmp/work-agent-after.csv
```

When both CSVs include the new grouped columns, `compare` also prints per-group average CPU, RSS, and process-count deltas.

Example output:

```text
Before: samples=180 avg_cpu=82.14 max_cpu=146.20 avg_mem_pct=4.12 max_mem_pct=4.90 avg_rss_mb=1120.33 max_rss_mb=1288.40
After:  samples=180 avg_cpu=61.87 max_cpu=108.70 avg_mem_pct=4.01 max_mem_pct=4.72 avg_rss_mb=1098.52 max_rss_mb=1240.11
Delta: avg_cpu=-20.27 (-24.7%) max_cpu=-37.50 (-25.6%) avg_rss_mb=-21.81 (-1.9%)
```

## How to interpret results

The strongest evidence of improvement is:

- Lower `avg_cpu`
- Lower `max_cpu`
- Lower per-process energy impact in `powermetrics`
- Similar or better UX while the same scenario is running

For this specific optimization, I would expect:

- Noticeable reduction in `avg_cpu`
- Reduced CPU spikes during streaming
- Small or neutral memory change

## Notes

- `scripts/benchmark-electron-process.sh` aggregates the root Electron process and all child processes.
- If the app exits before the benchmark finishes, the script stops early.
- `xctrace` can provide deeper profiling, but on this machine the active developer directory is Command Line Tools only, not full Xcode, so `xctrace` is not currently usable.
