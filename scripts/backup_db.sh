#!/usr/bin/env bash
#
# Betia Database Backup Script
# Usage: ./backup_db.sh <DATABASE_URL> [BACKUP_DIR]
#
# Example cron entry to run daily at 3am:
# 0 3 * * * /path/to/betia/scripts/backup_db.sh "postgres://user:pass@host/db" /path/to/backups

set -euo pipefail

DB_URL="${1:-}"
BACKUP_DIR="${2:-./backups}"

if [ -z "$DB_URL" ]; then
  echo "Error: Missing DATABASE_URL argument."
  echo "Usage: $0 <DATABASE_URL> [BACKUP_DIR]"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/betia_backup_$TIMESTAMP.sql.gz"

echo "[$(date -Iseconds)] Starting backup of betia database..."

# pg_dump requires PostgreSQL client tools to be installed.
# We use gzip to compress the output on the fly.
pg_dump --no-owner --no-privileges -d "$DB_URL" | gzip > "$BACKUP_FILE"

echo "[$(date -Iseconds)] Backup successfully saved to: $BACKUP_FILE"

# Keep only the last 7 backups, remove older ones
echo "[$(date -Iseconds)] Cleaning up old backups (keeping last 7 days)..."
ls -tp "$BACKUP_DIR"/betia_backup_*.sql.gz | grep -v '/$' | tail -n +8 | xargs -I {} rm -f -- {} || true

echo "[$(date -Iseconds)] Backup process complete."
