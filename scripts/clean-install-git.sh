#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PC_TEST_ROOT="${PC_TEST_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/pilibala-clean-install-git.XXXXXX")}"
PC_HOME="${PC_HOME:-$PC_TEST_ROOT/home}"
PC_CACHE="${PC_CACHE:-$PC_TEST_ROOT/npm-cache}"
KEEP_TEMP="${KEEP_TEMP:-0}"

cleanup() {
  if [ "$KEEP_TEMP" != "1" ]; then
    rm -rf "$PC_TEST_ROOT"
  fi
}
trap cleanup EXIT

mkdir -p "$PC_HOME" "$PC_CACHE"

echo "REPO_ROOT: $REPO_ROOT"
echo "PC_TEST_ROOT: $PC_TEST_ROOT"
echo "PC_HOME: $PC_HOME"

env \
  HOME="$PC_HOME" \
  PILIBALA_HOME="$PC_HOME/.pilibala" \
  npm_config_cache="$PC_CACHE" \
  npm_config_userconfig="$PC_HOME/.npmrc" \
  PATH="$PC_HOME/.local/bin:$PATH" \
  pnpm --dir "$REPO_ROOT" pilibalaai install --yes

test -x "$PC_HOME/.local/bin/pilibalaai"
test -L "$PC_HOME/.pilibala/cli/current"
test -f "$PC_HOME/.pilibala/cli/install.json"

env HOME="$PC_HOME" PILIBALA_HOME="$PC_HOME/.pilibala" PATH="$PC_HOME/.local/bin:$PATH" pilibalaai --version
env HOME="$PC_HOME" PILIBALA_HOME="$PC_HOME/.pilibala" PATH="$PC_HOME/.local/bin:$PATH" pilibalaai doctor \
  --config "$PC_TEST_ROOT/missing-config.json" >/dev/null || true

env \
  HOME="$PC_HOME" \
  PILIBALA_HOME="$PC_HOME/.pilibala" \
  PATH="$PC_HOME/.local/bin:$PATH" \
  pnpm --dir "$REPO_ROOT" pilibalaai uninstall

test ! -e "$PC_HOME/.pilibala/cli"
test ! -e "$PC_HOME/.local/bin/pilibalaai"
