#!/bin/sh
set -eu
HOME=${HOME:-/home/forge}
export HOME

set -a
. "$HOME/.config/xcp-recovery-bootstrap.env"
set +a

export RECOVERY_FOLLOW_IMPORT=1
/usr/bin/node "$HOME/.local/lib/xcp-recovery/reconcile-recovery.mjs"
exec /usr/bin/sleep infinity
