#!/bin/sh
set -eu

HOME=${HOME:-/home/forge}
export HOME

set -a
. "$HOME/.config/xcp-recovery-bootstrap.env"
set +a

cd "$HOME/.local/lib/xcp-recovery"
exec /usr/bin/node ./audit-recovery-r2.mjs
