#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Run a command in a throwaway Node container with the repo mounted, for hosts
# without a local Node.js. Usage: scripts/dev-node.sh npm test
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
exec docker run --rm -i \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$ROOT:/app" -w /app \
  node:24-alpine "$@"
