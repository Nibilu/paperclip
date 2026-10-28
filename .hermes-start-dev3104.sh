#!/usr/bin/env bash
set -a
. /home/amber/pilibala/.env
set +a
# DATABASE_URL is derived at runtime from the dev unit (source of truth) — no credentials in the repo.
DATABASE_URL="$(systemctl --user cat paperclip-dev.service 2>/dev/null | sed -n 's/^Environment="DATABASE_URL=\(.*\)"$/\1/p')"
[ -n "$DATABASE_URL" ] || echo "WARNING: DATABASE_URL not found in paperclip-dev.service; set it manually." >&2
export DATABASE_URL
export PORT=3104
export HOST=0.0.0.0
export PILIBALA_BIND=lan
export PILIBALA_INSTANCE_ID=default
export PILIBALA_DEPLOYMENT_MODE=authenticated
export PILIBALA_DEPLOYMENT_EXPOSURE=private
export PILIBALA_MIGRATION_AUTO_APPLY=true
export PILIBALA_MIGRATION_PROMPT=never
export HEARTBEAT_SCHEDULER_ENABLED=true
export PILIBALA_UI_DEV_MIDDLEWARE=false
export PILIBALA_ALLOWED_HOSTNAMES='192.168.31.16,localhost,127.0.0.1,clip.nibilu.in'
export PILIBALA_INSECURE_AUTH_HTTP_HOSTS=192.168.31.16
export BETTER_AUTH_TRUSTED_ORIGINS='http://192.168.31.16:3104,http://localhost:3104,http://127.0.0.1:3104,https://clip.nibilu.in'
cd /home/amber/pilibala/server
exec ./node_modules/.bin/tsx src/index.ts
