#!/usr/bin/env bash
# Spins up a throwaway local Postgres cluster, applies the Supabase shim + all migrations, and runs the
# database test suite (constraints, aggregates, RPCs, RLS). Requires Postgres binaries (initdb, pg_ctl) on PATH.
# Usage: npm run test:db            (or DATABASE_URL=postgres://... to use an existing empty database)
set -euo pipefail
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${DATABASE_URL:-}" ]; then
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/hardest-pg.XXXXXX")"
  PORT="${PGPORT_TEST:-54329}"
  initdb -D "$TMP/data" -U postgres --auth=trust >/dev/null
  pg_ctl -D "$TMP/data" -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l "$TMP/log" -w start >/dev/null
  trap 'pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT
  export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/db/supabase-shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"
fi
cd "$ROOT" && DB_TESTS=1 npx vitest run tests/db "$@"
