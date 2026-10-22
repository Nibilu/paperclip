#!/usr/bin/env bash
# RETIRED 2026-10-17 — do not use.
#
# This script used to start an ad-hoc "db-owner" API on :3101 purely to own the
# shared embedded PostgreSQL (DATABASE_URL unset -> embedded server on 54329).
# The embedded PostgreSQL is now owned by the user-level systemd unit
#   paperclip-embedded-postgres.service   (Restart=always, RestartSec=3)
# so nothing needs to keep a paperclip API alive just to host the database.
#
# Usage now:
#   systemctl --user status  paperclip-embedded-postgres.service
#   systemctl --user restart paperclip-embedded-postgres.service
#   journalctl --user -u paperclip-embedded-postgres.service -n 50
# Dev instance (database paperclip_dev) is :3104 via paperclip-dev.service.
echo "RETIRED: embedded PostgreSQL is managed by paperclip-embedded-postgres.service." >&2
echo "  systemctl --user status paperclip-embedded-postgres.service" >&2
echo "Dev API is :3104 (paperclip-dev.service), not :3101." >&2
exit 1
