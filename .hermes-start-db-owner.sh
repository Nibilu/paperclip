#!/usr/bin/env bash
# RETIRED 2026-10-17 — do not use.
#
# This script used to start an ad-hoc "db-owner" API on :3101 purely to own the
# shared embedded PostgreSQL (DATABASE_URL unset -> embedded server on 54329).
# The embedded PostgreSQL is now owned by the user-level systemd unit
#   pilibala-embedded-postgres.service   (Restart=always, RestartSec=3)
# so nothing needs to keep a pilibala API alive just to host the database.
#
# Usage now:
#   systemctl --user status  pilibala-embedded-postgres.service
#   systemctl --user restart pilibala-embedded-postgres.service
#   journalctl --user -u pilibala-embedded-postgres.service -n 50
# Dev instance (database pilibala_dev) is :3104 via pilibala-dev.service.
echo "RETIRED: embedded PostgreSQL is managed by pilibala-embedded-postgres.service." >&2
echo "  systemctl --user status pilibala-embedded-postgres.service" >&2
echo "Dev API is :3104 (pilibala-dev.service), not :3101." >&2
exit 1
