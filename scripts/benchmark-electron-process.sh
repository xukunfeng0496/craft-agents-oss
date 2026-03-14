#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/benchmark-electron-process.sh collect --pid PID [--duration 120] [--interval 1] [--output FILE]
  scripts/benchmark-electron-process.sh collect --match PATTERN [--duration 120] [--interval 1] [--output FILE]
  scripts/benchmark-electron-process.sh compare BEFORE.csv AFTER.csv

Examples:
  scripts/benchmark-electron-process.sh collect --match 'Work Agents|Electron' --duration 180 --output /tmp/before.csv
  scripts/benchmark-electron-process.sh compare /tmp/before.csv /tmp/after.csv

Notes:
  - collect aggregates the root process and all descendant processes.
  - collect also breaks samples into process groups: main, renderer, gpu, utility,
    claude_sdk, codex, copilot, and other.
  - output is CSV with one row per sample.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

collect_descendants() {
  local root_pid="$1"
  local queue=("$root_pid")
  local seen=()

  while ((${#queue[@]} > 0)); do
    local pid="${queue[0]}"
    queue=("${queue[@]:1}")

    local already_seen=0
    for existing in "${seen[@]:-}"; do
      if [[ "$existing" == "$pid" ]]; then
        already_seen=1
        break
      fi
    done
    if [[ "$already_seen" -eq 1 ]]; then
      continue
    fi

    seen+=("$pid")

    while IFS= read -r child_pid; do
      [[ -n "$child_pid" ]] && queue+=("$child_pid")
    done < <(pgrep -P "$pid" || true)
  done

  printf '%s\n' "${seen[@]}"
}

resolve_root_pid() {
  local pid="${1:-}"
  local pattern="${2:-}"

  if [[ -n "$pid" ]]; then
    echo "$pid"
    return 0
  fi

  if [[ -n "$pattern" ]]; then
    local matched
    matched="$(pgrep -fo "$pattern" || true)"
    if [[ -n "$matched" ]]; then
      echo "$matched"
      return 0
    fi
  fi

  return 1
}

print_summary() {
  local file="$1"
  awk -F',' '
    NR == 1 { next }
    {
      count += 1
      cpu += $3
      rss += $5
      mem += $4
      if ($3 > max_cpu) max_cpu = $3
      if ($5 > max_rss) max_rss = $5
      if ($4 > max_mem) max_mem = $4
    }
    END {
      if (count == 0) {
        print "No samples collected."
        exit 1
      }
      printf "samples=%d avg_cpu=%.2f max_cpu=%.2f avg_mem_pct=%.2f max_mem_pct=%.2f avg_rss_mb=%.2f max_rss_mb=%.2f\n",
        count, cpu / count, max_cpu, mem / count, max_mem, rss / count, max_rss
    }
  ' "$file"
}

print_group_summary() {
  local file="$1"
  awk -F',' '
    NR == 1 {
      for (i = 1; i <= NF; i++) {
        header[$i] = i
      }
      groups[1] = "main"
      groups[2] = "renderer"
      groups[3] = "gpu"
      groups[4] = "utility"
      groups[5] = "claude_sdk"
      groups[6] = "codex"
      groups[7] = "copilot"
      groups[8] = "other"
      next
    }
    {
      count += 1
      for (g = 1; g <= 8; g++) {
        group = groups[g]
        cpu_col = header[group "_cpu"]
        rss_col = header[group "_rss_mb"]
        count_col = header[group "_count"]
        if (cpu_col > 0) cpu[group] += $(cpu_col)
        if (rss_col > 0) rss[group] += $(rss_col)
        if (count_col > 0) proc_count[group] += $(count_col)
      }
    }
    END {
      if (count == 0 || !header["main_cpu"]) {
        exit 0
      }
      for (g = 1; g <= 8; g++) {
        group = groups[g]
        printf "%s_avg_cpu=%.2f %s_avg_rss_mb=%.2f %s_avg_count=%.2f\n",
          group, cpu[group] / count, group, rss[group] / count, group, proc_count[group] / count
      }
    }
  ' "$file"
}

sample_stats() {
  local root_pid="$1"
  local pid_csv="$2"

  ps -o pid=,%cpu=,%mem=,rss=,args= -p "$pid_csv" | awk -v root_pid="$root_pid" '
    BEGIN {
      root_pid += 0
      groups[1] = "main"
      groups[2] = "renderer"
      groups[3] = "gpu"
      groups[4] = "utility"
      groups[5] = "claude_sdk"
      groups[6] = "codex"
      groups[7] = "copilot"
      groups[8] = "other"
    }
    function classify(pid, args, lower_args) {
      lower_args = tolower(args)

      if (pid == root_pid) return "main"
      if (lower_args ~ /--type=renderer/) return "renderer"
      if (lower_args ~ /--type=gpu-process/) return "gpu"
      if (lower_args ~ /--type=utility/ || lower_args ~ /utilitysubtype=/) return "utility"
      if (lower_args ~ /claude-agent-sdk\/cli\.js/ || lower_args ~ /claude-agent-sdk\\cli\.js/) return "claude_sdk"
      if ((lower_args ~ /(^|[[:space:]\/])codex([[:space:]]|$)/ && lower_args ~ /app-server/) || lower_args ~ /vendor\/codex\// || lower_args ~ /vendor\\codex\\/) return "codex"
      if (lower_args ~ /copilot/) return "copilot"
      return "other"
    }
    {
      pid = $1 + 0
      cpu_val = $2 + 0
      mem_val = $3 + 0
      rss_mb_val = ($4 + 0) / 1024
      args = substr($0, index($0, $5))
      group = classify(pid, args)

      total_cpu += cpu_val
      total_mem += mem_val
      total_rss_mb += rss_mb_val
      total_count += 1

      group_cpu[group] += cpu_val
      group_rss_mb[group] += rss_mb_val
      group_count[group] += 1

      if (all_pids != "") all_pids = all_pids "|" pid
      else all_pids = pid
    }
    END {
      printf "%.2f,%.2f,%.2f,%d,%s", total_cpu, total_mem, total_rss_mb, total_count, all_pids
      for (i = 1; i <= 8; i++) {
        group = groups[i]
        printf ",%.2f,%.2f,%d", group_cpu[group] + 0, group_rss_mb[group] + 0, group_count[group] + 0
      }
    }
  '
}

compare_files() {
  local before_file="$1"
  local after_file="$2"
  local before_summary after_summary
  local before_groups after_groups

  before_summary="$(print_summary "$before_file")"
  after_summary="$(print_summary "$after_file")"
  before_groups="$(print_group_summary "$before_file")"
  after_groups="$(print_group_summary "$after_file")"

  echo "Before: $before_summary"
  echo "After:  $after_summary"

  awk '
    function parse(summary, key,   i, n, parts, kv) {
      n = split(summary, parts, " ")
      for (i = 1; i <= n; i++) {
        split(parts[i], kv, "=")
        if (kv[1] == key) return kv[2] + 0
      }
      return 0
    }
    BEGIN {
      before = ENVIRON["BEFORE_SUMMARY"]
      after = ENVIRON["AFTER_SUMMARY"]

      before_avg_cpu = parse(before, "avg_cpu")
      after_avg_cpu = parse(after, "avg_cpu")
      before_max_cpu = parse(before, "max_cpu")
      after_max_cpu = parse(after, "max_cpu")
      before_avg_rss = parse(before, "avg_rss_mb")
      after_avg_rss = parse(after, "avg_rss_mb")

      cpu_delta = after_avg_cpu - before_avg_cpu
      cpu_delta_pct = before_avg_cpu == 0 ? 0 : (cpu_delta / before_avg_cpu) * 100
      max_cpu_delta = after_max_cpu - before_max_cpu
      max_cpu_delta_pct = before_max_cpu == 0 ? 0 : (max_cpu_delta / before_max_cpu) * 100
      rss_delta = after_avg_rss - before_avg_rss
      rss_delta_pct = before_avg_rss == 0 ? 0 : (rss_delta / before_avg_rss) * 100

      printf "Delta: avg_cpu=%+.2f (%+.1f%%) max_cpu=%+.2f (%+.1f%%) avg_rss_mb=%+.2f (%+.1f%%)\n",
        cpu_delta, cpu_delta_pct, max_cpu_delta, max_cpu_delta_pct, rss_delta, rss_delta_pct
    }
  '

  if [[ -n "$before_groups" && -n "$after_groups" ]]; then
    echo
    echo "Group deltas:"
    BEFORE_GROUPS="$before_groups" AFTER_GROUPS="$after_groups" awk '
      function parse(lines, key,   n, i, parts, kv) {
        n = split(lines, parts, /[ \n]+/)
        for (i = 1; i <= n; i++) {
          split(parts[i], kv, "=")
          if (kv[1] == key) return kv[2] + 0
        }
        return 0
      }
      BEGIN {
        before = ENVIRON["BEFORE_GROUPS"]
        after = ENVIRON["AFTER_GROUPS"]
        split("main renderer gpu utility claude_sdk codex copilot other", groups, " ")
        for (i = 1; i <= 8; i++) {
          group = groups[i]
          before_cpu = parse(before, group "_avg_cpu")
          after_cpu = parse(after, group "_avg_cpu")
          before_rss = parse(before, group "_avg_rss_mb")
          after_rss = parse(after, group "_avg_rss_mb")
          before_count = parse(before, group "_avg_count")
          after_count = parse(after, group "_avg_count")
          printf "%-10s avg_cpu=%+.2f avg_rss_mb=%+.2f avg_count=%+.2f\n",
            group ":", after_cpu - before_cpu, after_rss - before_rss, after_count - before_count
        }
      }
    '
  fi
}

collect_mode() {
  require_cmd ps
  require_cmd pgrep
  require_cmd awk

  local pid=""
  local match=""
  local duration="120"
  local interval="1"
  local output=""

  while (($# > 0)); do
    case "$1" in
      --pid)
        pid="${2:-}"
        shift 2
        ;;
      --match)
        match="${2:-}"
        shift 2
        ;;
      --duration)
        duration="${2:-}"
        shift 2
        ;;
      --interval)
        interval="${2:-}"
        shift 2
        ;;
      --output)
        output="${2:-}"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  local root_pid
  if ! root_pid="$(resolve_root_pid "$pid" "$match")"; then
    echo "Could not resolve root PID. Pass --pid or --match." >&2
    exit 1
  fi

  if [[ -z "$output" ]]; then
    output="/tmp/work-agent-benchmark-${root_pid}-$(date +%Y%m%d-%H%M%S).csv"
  fi

  echo "timestamp,sample_index,total_cpu,total_mem_pct,total_rss_mb,process_count,pids,main_cpu,main_rss_mb,main_count,renderer_cpu,renderer_rss_mb,renderer_count,gpu_cpu,gpu_rss_mb,gpu_count,utility_cpu,utility_rss_mb,utility_count,claude_sdk_cpu,claude_sdk_rss_mb,claude_sdk_count,codex_cpu,codex_rss_mb,codex_count,copilot_cpu,copilot_rss_mb,copilot_count,other_cpu,other_rss_mb,other_count" > "$output"

  local samples
  samples="$(awk -v d="$duration" -v i="$interval" 'BEGIN { printf "%d", d / i }')"
  if [[ "$samples" -le 0 ]]; then
    echo "Duration must be >= interval." >&2
    exit 1
  fi

  echo "Collecting benchmark samples..."
  echo "  root_pid: $root_pid"
  echo "  duration: ${duration}s"
  echo "  interval: ${interval}s"
  echo "  output:   $output"

  local index
  for ((index = 1; index <= samples; index++)); do
    if ! kill -0 "$root_pid" 2>/dev/null; then
      echo "Root PID $root_pid exited before benchmark completed." >&2
      break
    fi

    mapfile -t pid_list < <(collect_descendants "$root_pid")
    local pid_csv
    pid_csv="$(IFS=,; echo "${pid_list[*]}")"

    local stats
    stats="$(sample_stats "$root_pid" "$pid_csv")"

    printf "%s,%d,%s\n" "$(date '+%Y-%m-%dT%H:%M:%S')" "$index" "$stats" >> "$output"
    sleep "$interval"
  done

  echo
  echo "Summary:"
  print_summary "$output"
  local group_summary
  group_summary="$(print_group_summary "$output")"
  if [[ -n "$group_summary" ]]; then
    echo
    echo "Group summary:"
    echo "$group_summary"
  fi
}

main() {
  if (($# == 0)); then
    usage
    exit 1
  fi

  local command="$1"
  shift

  case "$command" in
    collect)
      collect_mode "$@"
      ;;
    compare)
      if [[ $# -ne 2 ]]; then
        usage
        exit 1
      fi
      BEFORE_SUMMARY="$(print_summary "$1")" AFTER_SUMMARY="$(print_summary "$2")" compare_files "$1" "$2"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
