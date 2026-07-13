#!/bin/sh
set -eu

repo_dir=${1:-$(pwd)}
ops_dir="$repo_dir/apps/api/ops"
lib_dir="$HOME/.local/lib/xcp-recovery"
unit_dir="$HOME/.config/systemd/user"

test -f "$HOME/.config/xcp-recovery-bootstrap.env" || {
  echo "missing $HOME/.config/xcp-recovery-bootstrap.env" >&2
  exit 1
}

install -d -m 700 "$lib_dir" "$unit_dir"
install -m 600 "$ops_dir/bootstrap-recovery.mjs" "$lib_dir/"
install -m 600 "$ops_dir/recovery-bootstrap-pipeline.mjs" "$lib_dir/"
install -m 600 "$ops_dir/reconcile-recovery.mjs" "$lib_dir/"
install -m 600 "$ops_dir/bootstrap-stamp-protection.mjs" "$lib_dir/"
install -m 600 "$ops_dir/export-recovery.php" "$lib_dir/"
install -m 700 "$ops_dir/run-recovery-import.sh" "$lib_dir/"
install -m 700 "$ops_dir/run-recovery-reconcile.sh" "$lib_dir/"
install -m 600 "$ops_dir/systemd/xcp-recovery-import.service" "$unit_dir/"
install -m 600 "$ops_dir/systemd/xcp-recovery-reconcile.service" "$unit_dir/"
install -m 600 "$ops_dir/systemd/xcp-recovery-stamps.service" "$unit_dir/"
chmod 600 "$HOME/.config/xcp-recovery-bootstrap.env"
systemctl --user daemon-reload

echo "Installed secured recovery programs and units."
echo "Restart active units individually after recording their durable remote cursors."
