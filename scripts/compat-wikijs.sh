#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Checks the built rendering module against official Wiki.js images in
# throwaway containers. Never touches a running wiki.
# Usage: scripts/compat-wikijs.sh [image ...]   (default: ghcr.io/requarks/wiki:2)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODULE="$ROOT/dist/wikijs-module/html-psono-connector"
[ -f "$MODULE/renderer.js" ] || { echo "Build first: npm run build" >&2; exit 1; }
[ $# -gt 0 ] || set -- ghcr.io/requarks/wiki:2
status=0
for image in "$@"; do
  docker run --rm --network none --entrypoint node \
    -v "$MODULE:/wiki/server/modules/rendering/html-psono-connector:ro" \
    -v "$ROOT/scripts/compat-wikijs.cjs:/tmp/compat.cjs:ro" \
    "$image" /tmp/compat.cjs || status=1
done
exit $status
