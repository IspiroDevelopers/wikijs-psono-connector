#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# Prepares a deployment directory: generates the master key and the database
# credentials, creates connector.env from the example. Never overwrites an
# existing file. Usage:
#   sh scripts/init-secrets.sh [directory]      (default: ./deploy)
set -eu

DIR="${1:-$(dirname "$0")/../deploy}"
mkdir -p "$DIR"
cd "$DIR"
umask 077

created() { echo "  created  $1"; }
kept()    { echo "  kept     $1 (already exists, not touched)"; }

[ -f master.key ] && kept master.key || { openssl rand -hex 32 > master.key; created master.key; }
[ -f .db-secret ] && kept .db-secret || { openssl rand -hex 24 > .db-secret; created .db-secret; }
if [ -f database.url ]; then kept database.url; else
  printf 'postgres://psono_connector:%s@psono-connector-db:5432/psono_connector' "$(cat .db-secret)" > database.url
  created database.url
fi
if [ -f connector.env ]; then kept connector.env; else
  cp "$(dirname "$0")/../deploy/connector.env.example" connector.env 2>/dev/null \
    || cp connector.env.example connector.env
  umask 022; chmod 640 connector.env
  created connector.env
fi

cat <<NEXT

Next steps
  1. BACK UP master.key somewhere safe and offline (losing it only forces users
     to re-enter their API keys; leaking it weakens the stored keys).
  2. Edit connector.env: the three public URLs (https://), and
     PSONO_SERVER_VERIFY_KEY — print it with:
       docker run --rm -e PSONO_API_BASE_URL=https://psono.example.com/server \\
         <image> node main.cjs print-server-pin
     and compare it with the "server signature" in Psono before using it.
  3. docker compose up -d
  4. docker compose exec psono-connector node main.cjs doctor
NEXT
