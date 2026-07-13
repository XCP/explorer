#!/bin/sh
set -eu

execute=0
test "${1:-}" = "--execute" && execute=1

units="xcp-recovery-import.service xcp-recovery-reconcile.service xcp-recovery-stamps.service"
tmp_files="/tmp/audit-recovery.php /tmp/audit-recovery-stamps.php /tmp/bootstrap-recovery.mjs /tmp/export-recovery.php /tmp/reconcile-recovery.mjs /tmp/recovery-bootstrap.log /tmp/recovery-bootstrap-pipeline.mjs /tmp/recovery-reconcile.log /tmp/xcp-recovery-stamps.service"

echo "Recovery bootstrap retirement"
echo "Units: $units"
echo "Program directory: $HOME/.local/lib/xcp-recovery"
echo "Secret environment: $HOME/.config/xcp-recovery-bootstrap.env"
echo "Temporary files: $tmp_files"
echo "Cloudflare private Worker deletion and Forge SSH-key revocation are separate control-plane steps."

if [ "$execute" -eq 0 ]; then
  echo "Dry run only. Re-run with --execute after every gate in docs/recovery-operations.md passes."
  exit 0
fi

test "${RECOVERY_RETIRE_CONFIRMED:-}" = "yes" || {
  echo "Set RECOVERY_RETIRE_CONFIRMED=yes only after completing the retirement gates." >&2
  exit 1
}

for unit in $units; do
  systemctl --user disable --now "$unit" 2>/dev/null || true
done
rm -f "$HOME/.config/systemd/user"/xcp-recovery-*.service
rm -rf "$HOME/.local/lib/xcp-recovery"
rm -f "$HOME/.config/xcp-recovery-bootstrap.env"
for file in $tmp_files; do rm -f "$file"; done
systemctl --user daemon-reload
systemctl --user reset-failed
echo "Host-side recovery bootstrap resources retired."
