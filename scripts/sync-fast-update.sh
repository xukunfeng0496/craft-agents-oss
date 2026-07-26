#!/usr/bin/env bash
#
# Sync a published GitHub Release (signed/notarized macOS arm64 + Windows x64) to
# the CVTE intranet fast-update-server. Run from an INTRANET machine — the public
# GitHub side can't reach rxpc, and (since the local hosts redirect was removed)
# rxpc resolves to the real intranet server, so this must run on the CVTE network.
#
# Usage:
#   FAST_UPDATE_TOKEN=… scripts/sync-fast-update.sh <version> [channel]
#
#   <version>   release version WITHOUT the leading v, e.g. 0.10.318
#               (the script downloads release tag v<version> from the fork)
#   [channel]   beta (default, safe — no prod impact) | stable (FULL rollout:
#               every v0.7.1 user OTAs; v0.7.1 only sees stable)
#
# Promote beta → stable WITHOUT re-downloading (the server has no cross-channel
# copy endpoint; files are stored per {channel}/{version}, so stable still needs
# the upload — but the artifacts already verified+staged by the beta run are reused):
#   SKIP_DOWNLOAD=1 FAST_UPDATE_TOKEN=… scripts/sync-fast-update.sh 0.10.318 stable
#
# Flow: gh release download v<version> → verify mac+win sha512 against the ymls →
# stage dmg/zip/exe/blockmaps/ymls → upload to rxpc + changelog → check OTA contract.
set -euo pipefail

VERSION="${1:?usage: FAST_UPDATE_TOKEN=… $0 <version> [channel]   (e.g. 0.10.318 beta)}"
CHANNEL="${2:-beta}"
SKIP_DOWNLOAD="${SKIP_DOWNLOAD:-0}"   # 1 = reuse already-staged artifacts (promote without re-download)
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

if [ "$SKIP_DOWNLOAD" = "1" ]; then
  echo "==> SKIP_DOWNLOAD=1: promoting already-staged v$VERSION in $RELEASE_DIR → $CHANNEL (no re-download)"
  for f in "Work-Agent-${VERSION}-osx-arm64.dmg" "Work-Agent-${VERSION}-osx-arm64.zip" \
           "Work-Agent-${VERSION}-windows-x64.exe" latest-mac.yml latest.yml; do
    [ -f "$RELEASE_DIR/$f" ] || { echo "ERROR: $RELEASE_DIR/$f missing — run a full sync (no SKIP_DOWNLOAD) first"; exit 1; }
  done
  echo "    ✅ staged artifacts present (sha512 was verified by the original sync)"
else
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  echo "==> downloading release v$VERSION (mac + win assets) from $REPO"
  gh release download "v$VERSION" -R "$REPO" -D "$TMP" \
    --pattern "Work-Agent-${VERSION}-*" --pattern "latest*.yml"

  MAC_YML="$TMP/latest-mac.yml"
  WIN_YML="$TMP/latest.yml"
  [ -f "$MAC_YML" ] || { echo "ERROR: latest-mac.yml not in release v$VERSION"; exit 1; }
  [ -f "$WIN_YML" ] || { echo "ERROR: latest.yml not in release v$VERSION"; exit 1; }
  echo "==> release v$VERSION → channel: $CHANNEL"

  # sha512 (base64) of the primary download for each platform, cross-checked vs its yml.
  verify_sha() {
    local file="$1" yml="$2" label="$3"
    local local_sha yml_sha
    local_sha="$(openssl dgst -sha512 -binary "$TMP/$file" | openssl base64 -A)"
    yml_sha="$(grep -A1 "$file" "$yml" | grep 'sha512:' | head -1 | sed 's/.*sha512: //' | tr -d '\r')"
    [ "$local_sha" = "$yml_sha" ] || { echo "ERROR: $label sha512 mismatch (artifact corrupt)"; exit 1; }
    echo "    ✅ $label sha512 OK"
  }
  echo "==> verifying sha512"
  verify_sha "Work-Agent-${VERSION}-osx-arm64.zip" "$MAC_YML" "mac arm64"
  verify_sha "Work-Agent-${VERSION}-windows-x64.exe" "$WIN_YML" "win x64"

  echo "==> staging into $RELEASE_DIR"
  mkdir -p "$RELEASE_DIR"
  rm -f "$RELEASE_DIR"/Work-Agent-* "$RELEASE_DIR"/latest*.yml  # drop stale builds → never upload an old version
  for f in "Work-Agent-${VERSION}-osx-arm64.dmg" "Work-Agent-${VERSION}-osx-arm64.dmg.blockmap" \
           "Work-Agent-${VERSION}-osx-arm64.zip" "Work-Agent-${VERSION}-osx-arm64.zip.blockmap" \
           "Work-Agent-${VERSION}-windows-x64.exe" "Work-Agent-${VERSION}-windows-x64.exe.blockmap" \
           latest-mac.yml latest.yml; do
    cp "$TMP/$f" "$RELEASE_DIR/"
  done
fi

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
