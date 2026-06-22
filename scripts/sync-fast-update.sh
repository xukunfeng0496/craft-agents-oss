#!/usr/bin/env bash
#
# Sync a GitHub Actions build artifact (the signed/notarized macOS arm64 set) to
# the CVTE intranet fast-update-server. Run from an INTRANET machine (the public
# GitHub runner can't reach rxpc; this bridges that air-gap).
#
# Usage:
#   FAST_UPDATE_TOKEN=… scripts/sync-fast-update.sh <github-run-id> [channel]
#
#   <github-run-id>  the fork's Build run whose `mac-dmg` artifact to publish
#                    (find via: gh run list -R xukunfeng0496/work-agents)
#   [channel]        beta (default, safe — no prod impact) | stable (FULL rollout:
#                    every v0.7.1 user OTAs; v0.7.1 only sees stable)
#
# What it does: download artifact → derive version from latest-mac.yml → verify
# sha512 → upload arm64 dmg/zip/blockmaps/yml + changelog → check OTA contract.
set -euo pipefail

RUN_ID="${1:?usage: FAST_UPDATE_TOKEN=… $0 <github-run-id> [channel]}"
CHANNEL="${2:-beta}"
REPO="xukunfeng0496/work-agents"
SERVER="https://rxpc.gz.cvte.cn/fast-update-server"   # https: http 302→https strips the auth header
PRODUCT="work-agents"
: "${FAST_UPDATE_TOKEN:?FAST_UPDATE_TOKEN is required (intranet-held; never commit)}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/apps/electron/release"
export NO_PROXY=".gz.cvte.cn,.cvte.com,.cvtapi.com,127.0.0.1,localhost"
export no_proxy="$NO_PROXY"

if [ "$CHANNEL" = "stable" ]; then
  echo "⚠️  channel=stable → FULL production rollout (all v0.7.1 users will OTA). Ctrl-C within 5s to abort."
  sleep 5
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "==> downloading mac-dmg artifact from run $RUN_ID"
gh run download "$RUN_ID" -R "$REPO" --name mac-dmg -D "$TMP"

YML="$TMP/latest-mac.yml"
[ -f "$YML" ] || { echo "ERROR: latest-mac.yml not in artifact"; exit 1; }
VERSION="$(grep -m1 '^version:' "$YML" | awk '{print $2}' | tr -d '\r')"
echo "==> artifact version: $VERSION  → channel: $CHANNEL"

echo "==> verifying arm64 zip sha512 against latest-mac.yml"
LOCAL_SHA="$(openssl dgst -sha512 -binary "$TMP/Work-Agent-${VERSION}-osx-arm64.zip" | openssl base64 -A)"
YML_SHA="$(grep -A1 "Work-Agent-${VERSION}-osx-arm64.zip" "$YML" | grep 'sha512:' | head -1 | sed 's/.*sha512: //' | tr -d '\r')"
[ "$LOCAL_SHA" = "$YML_SHA" ] || { echo "ERROR: sha512 mismatch (artifact corrupt)"; exit 1; }
echo "    ✅ sha512 OK"

echo "==> staging into $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
for f in "Work-Agent-${VERSION}-osx-arm64.dmg" "Work-Agent-${VERSION}-osx-arm64.dmg.blockmap" \
         "Work-Agent-${VERSION}-osx-arm64.zip" "Work-Agent-${VERSION}-osx-arm64.zip.blockmap" latest-mac.yml; do
  cp "$TMP/$f" "$RELEASE_DIR/"
done
# changelog (optional): the upload script reads apps/electron/RELEASE_NOTES.md
NOTE="$ROOT_DIR/apps/electron/resources/release-notes/$VERSION.md"
[ -f "$NOTE" ] && cp "$NOTE" "$ROOT_DIR/apps/electron/RELEASE_NOTES.md" && echo "    staged changelog $VERSION.md"

echo "==> uploading to $SERVER ($PRODUCT/$CHANNEL v$VERSION)"
FAST_UPDATE_VERSION="$VERSION" \
AUTO_UPDATE_SERVER_URL="$SERVER" AUTO_UPDATE_PRODUCT_ID="$PRODUCT" AUTO_UPDATE_CHANNEL="$CHANNEL" \
  bun run "$ROOT_DIR/scripts/upload-fast-update-release.ts"

echo "==> verifying OTA contract"
AUTO_UPDATE_SERVER_URL="$SERVER" AUTO_UPDATE_PRODUCT_ID="$PRODUCT" AUTO_UPDATE_CHANNEL="$CHANNEL" \
  bun run "$ROOT_DIR/scripts/test-ota-flow.ts" check

echo "✅ sync complete: v$VERSION on $CHANNEL"
