#!/bin/bash
# Monitor overlay creation and usage in real-time

echo "=== Monitoring Skill Variables Overlay ==="
echo "Watching for new overlay directories..."
echo "Press Ctrl+C to stop"
echo ""

# Watch for new overlay directories
fswatch -0 /var/folders/*/T/ 2>/dev/null | while read -d "" event; do
    if [[ "$event" == *"wa-skill-vars-"* ]]; then
        echo "[$(date '+%H:%M:%S')] Overlay event: $event"

        # If it's a new directory
        if [ -d "$event" ]; then
            echo "  → New overlay created: $event"

            # List skills in overlay
            if [ -d "$event/skills" ]; then
                echo "  → Skills in overlay:"
                ls -1 "$event/skills" 2>/dev/null | sed 's/^/    - /'

                # Show content of test-vars if exists
                if [ -f "$event/skills/test-vars/SKILL.md" ]; then
                    echo "  → test-vars content preview:"
                    grep -A 3 "当前配置" "$event/skills/test-vars/SKILL.md" | sed 's/^/    /'
                fi
            fi
        fi
        echo ""
    fi
done
