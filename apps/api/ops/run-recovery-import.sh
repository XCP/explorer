#!/bin/sh
set -eu
HOME=${HOME:-/home/forge}
export HOME

set -a
. "$HOME/.config/xcp-recovery-bootstrap.env"
set +a

export RECOVERY_SOURCE_LOCAL=1
export RECOVERY_EXPORT_SCRIPT="$HOME/.local/lib/xcp-recovery/export-recovery.php"
/usr/bin/node "$HOME/.local/lib/xcp-recovery/bootstrap-recovery.mjs"
exec /usr/bin/sleep infinity
