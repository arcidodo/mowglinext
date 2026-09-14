#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=lib/framework.sh
source "$SCRIPT_DIR/lib/framework.sh"

compose_file="$REPO_DIR/install/compose/docker-compose.gps.yml"
stack_file="$REPO_DIR/docker/stack.sh"
env_file="$REPO_DIR/install/lib/env.sh"

section "Universal GNSS sidecar lifecycle contract"

compose_content="$(<"$compose_file")"
assert_contains "NTRIP launch argument follows the canonical environment flag" \
  'ntrip_enabled:=${GNSS_NTRIP_ENABLED:-true}' "$compose_content"

reconcile_block="$(sed -n '/^[[:space:]]*reconcile-gps)/,/^[[:space:]]*;;/p' "$stack_file")"
assert_contains "gps reconciliation regenerates derived configuration" \
  'regen' "$reconcile_block"
assert_contains "gps reconciliation force-recreates only the gps service" \
  'compose up -d --no-deps --force-recreate gps' "$reconcile_block"
assert_not_contains "gps reconciliation does not remove unrelated services" \
  '--remove-orphans' "$reconcile_block"

env_content="$(<"$env_file")"
assert_contains "compose device mapping follows the canonical serial device" \
  'GNSS_DEVICE="${GNSS_SERIAL_DEVICE}"' "$env_content"
assert_contains "device group follows the current canonical device" \
  'GNSS_DEVICE_GID="$(stat -Lc' "$env_content"
assert_contains "NTRIP enabled state follows canonical configuration" \
  'GNSS_NTRIP_ENABLED="${CONFIG_NTRIP_ENABLED:-true}"' "$env_content"

test_summary
