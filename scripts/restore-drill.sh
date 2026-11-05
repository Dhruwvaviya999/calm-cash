#!/usr/bin/env bash
# Backup-and-restore drill: dump a database, restore it into a SEPARATE throw-away database,
# and prove the copy is complete — migrations, row counts, exact money totals, foreign keys,
# and (optionally) receipt files. Never writes to the source database.
#
#   SOURCE_DATABASE_URL=postgresql://…/calmcash_perf \
#   DRILL_DATABASE_URL=postgresql://…/calmcash_restore_drill \
#   [RECEIPTS_DIR=/path/to/receipt/backup] [BACKUP_DIR=/secure/dir] [KEEP_DRILL_DATABASE=1] \
#   bash scripts/restore-drill.sh
#
# Requires pg_dump, pg_restore, and psql of the server's major version on PATH, or set
# PG_DOCKER_CONTAINER=<container> to run them inside a local PostgreSQL container instead.
# The drill database name must end in "_restore_drill"; it is dropped and recreated.
# Connection strings are never printed. See docs/system-design/backup-and-disaster-recovery.md.
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL}"
: "${DRILL_DATABASE_URL:?Set DRILL_DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-$(mktemp -d)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

db_name() { node -e 'process.stdout.write(new URL(process.argv[1]).pathname.slice(1))' "$1"; }
SOURCE_DB="$(db_name "$SOURCE_DATABASE_URL")"
DRILL_DB="$(db_name "$DRILL_DATABASE_URL")"
if [[ "$DRILL_DB" != *_restore_drill ]]; then
  echo "DRILL_DATABASE_URL must name a database ending in _restore_drill." >&2
  exit 2
fi
if [[ "$DRILL_DB" == "$SOURCE_DB" ]]; then
  echo "The drill database must differ from the source." >&2
  exit 2
fi
# The maintenance connection for DROP/CREATE: same server, the "postgres" database.
ADMIN_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/postgres";process.stdout.write(u.href)' "$DRILL_DATABASE_URL")"

pg() {
  local tool="$1"
  shift
  if [[ -n "${PG_DOCKER_CONTAINER:-}" ]]; then
    MSYS_NO_PATHCONV=1 docker exec -i "$PG_DOCKER_CONTAINER" "$tool" "$@"
  else
    "$tool" "$@"
  fi
}
# Inside a container, "localhost" must mean the container itself.
in_pg() {
  if [[ -n "${PG_DOCKER_CONTAINER:-}" ]]; then
    node -e 'const u=new URL(process.argv[1]);u.hostname="localhost";u.port="5432";process.stdout.write(u.href)' "$1"
  else
    printf '%s' "$1"
  fi
}
q() { pg psql "$(in_pg "$1")" -v ON_ERROR_STOP=1 -tAqX -c "$2"; }

echo "== 1. Backup of '$SOURCE_DB' (custom format, compressed)"
DUMP="$BACKUP_DIR/$SOURCE_DB-$(date -u +%Y%m%dT%H%M%SZ).dump"
started=$(date +%s)
pg pg_dump --format=custom --no-owner --no-privileges "$(in_pg "$SOURCE_DATABASE_URL")" >"$DUMP"
echo "   $(du -h "$DUMP" | cut -f1) in $(($(date +%s) - started)) s; sha256 $(sha256sum "$DUMP" | cut -c1-16)…"

echo "== 2. Restore into '$DRILL_DB' (dropped and recreated)"
q "$ADMIN_URL" "DROP DATABASE IF EXISTS \"$DRILL_DB\" WITH (FORCE)"
q "$ADMIN_URL" "CREATE DATABASE \"$DRILL_DB\""
started=$(date +%s)
pg pg_restore --no-owner --no-privileges --exit-on-error --dbname="$(in_pg "$DRILL_DATABASE_URL")" <"$DUMP"
echo "   restored in $(($(date +%s) - started)) s"

echo "== 3. Migration history matches the checked-in migrations"
(cd "$ROOT" && DATABASE_URL="$DRILL_DATABASE_URL" DIRECT_URL="$DRILL_DATABASE_URL" \
  DATABASE_URL_UNPOOLED="$DRILL_DATABASE_URL" pnpm exec prisma migrate status >/dev/null) \
  && echo "   up to date" || { echo "   MIGRATION STATUS FAILED" >&2; exit 1; }

echo "== 4. Row counts and exact money checksums (source vs restored)"
CHECKS="
SELECT name, value FROM (
SELECT 'users' AS name, count(*)::text AS value FROM users UNION ALL
SELECT 'accounts', count(*) || ' / opening ' || coalesce(sum(opening_balance_minor), 0) FROM accounts UNION ALL
SELECT 'transactions', (SELECT count(*) FROM transactions) || ' / ' || coalesce((SELECT string_agg(currency || ':' || total, ',' ORDER BY currency) FROM (SELECT currency, sum(amount_minor) AS total FROM transactions GROUP BY currency) s), '') UNION ALL
SELECT 'transactions md5', md5(coalesce(string_agg(id::text || amount_minor::text || coalesce(voided_at::text, ''), ',' ORDER BY id), '')) FROM transactions UNION ALL
SELECT 'budgets', count(*) || ' / limits ' || coalesce(sum(limit_minor), 0) FROM budgets UNION ALL
SELECT 'recurring_schedules', count(*) || ' / ' || coalesce(sum(amount_minor), 0) FROM recurring_schedules UNION ALL
SELECT 'scheduled_occurrences', count(*)::text FROM scheduled_occurrences UNION ALL
SELECT 'savings_goals', count(*) || ' / targets ' || coalesce(sum(target_minor), 0) FROM savings_goals UNION ALL
SELECT 'goal_contributions', count(*) || ' / ' || coalesce(sum(amount_minor), 0) FROM goal_contributions UNION ALL
SELECT 'transaction_receipts', count(*) || ' / bytes ' || coalesce(sum(size_bytes), 0) FROM transaction_receipts UNION ALL
SELECT 'notifications', count(*)::text FROM notifications UNION ALL
SELECT 'financial_scenarios', count(*)::text FROM financial_scenarios UNION ALL
SELECT 'statement_imports', count(*)::text FROM statement_imports UNION ALL
SELECT 'ai_messages', count(*)::text FROM ai_messages
) checks ORDER BY name;"
source_report="$(q "$SOURCE_DATABASE_URL" "$CHECKS")"
drill_report="$(q "$DRILL_DATABASE_URL" "$CHECKS")"
paste -d'|' <(echo "$source_report") <(echo "$drill_report" | cut -d'|' -f2) |
  awk -F'|' '{ printf "   %-24s %-40s %s\n", $1, $2, ($2 == $3 ? "match" : "MISMATCH: " $3) }'
[[ "$source_report" == "$drill_report" ]] || { echo "   RESTORED DATA DIFFERS" >&2; exit 1; }

echo "== 5. Constraints restored and valid"
q "$DRILL_DATABASE_URL" "SELECT contype, count(*), count(*) FILTER (WHERE NOT convalidated) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' GROUP BY contype ORDER BY contype" |
  awk -F'|' '{ split("c:CHECK f:FOREIGN p:PRIMARY u:UNIQUE n:NOT-NULL x:EXCLUDE", m, " "); t=$1; for (i in m) { split(m[i], kv, ":"); if (kv[1]==$1) t=kv[2] } printf "   %-8s %5s constraints, %s not validated\n", t, $2, $3 }'
invalid="$(q "$DRILL_DATABASE_URL" "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND NOT convalidated")"
[[ "$invalid" == "0" ]] || { echo "   UNVALIDATED CONSTRAINTS" >&2; exit 1; }

if [[ -n "${RECEIPTS_DIR:-}" ]]; then
  echo "== 6. Receipt files against restored metadata"
  (cd "$ROOT/apps/api" && DATABASE_URL="$DRILL_DATABASE_URL" RECEIPT_STORAGE_PROVIDER=local \
    RECEIPT_STORAGE_DIR="$RECEIPTS_DIR" CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}" \
    NODE_ENV=development EMAIL_DELIVERY_MODE=disabled \
    node --import tsx src/cli/receipts-audit.ts) | sed 's/^/   /'
else
  echo "== 6. Receipt files: skipped (set RECEIPTS_DIR to a restored copy of receipt storage)"
fi

if [[ "${KEEP_DRILL_DATABASE:-}" != "1" ]]; then
  q "$ADMIN_URL" "DROP DATABASE \"$DRILL_DB\" WITH (FORCE)"
  echo "== Drill database dropped. Backup kept at $DUMP"
fi
echo "== Restore drill passed"
