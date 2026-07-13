# Recovery bootstrap operations

The recovery importer, Stamp bootstrap, and Electrs reconciler are temporary control-plane jobs. Their durable
state lives in D1 and R2, not in local log files. Do not retire the jobs merely because a process exits cleanly.

## Current temporary resources

- Forge-supervised daemons: import `945393` and reconciliation `945398`. These run the checked-in wrappers
  from the secured program directory and remain active independently of SSH login sessions.
- Disabled fallback user services: `xcp-recovery-import` and `xcp-recovery-reconcile` (do not enable while the
  Forge daemons exist). The completed one-shot Stamp service remains inactive.
- Secret environment: `~/.config/xcp-recovery-bootstrap.env` (mode `0600`).
- Secured program directory: `~/.local/lib/xcp-recovery` (directory mode `0700`, files `0600`).
- Private Cloudflare Worker: `xcp-recovery-bootstrap`.
- Temporary Forge SSH key: `codex-recovery-audit` (Forge key id `3016796`).
- Historical `/tmp/*recovery*` scripts and logs from the initial bootstrap deployment.

Run `ops/install-recovery-services.sh <repository-root>` to stage the checked-in programs, wrappers, and fallback
units. Record the remote D1 cursors before restarting one daemon at a time. The jobs resume from D1 receipts;
never derive a resume cursor from log output.

## Retirement gates

All of these must pass before host cleanup:

1. The source import has a non-null completion timestamp and its final receipt is contiguous.
2. Electrs reconciliation reports no rows with a null `chain_checked_at`.
3. Stamp protection is ready and its source/parity audit has been accepted.
4. After the source import completes, the full R2 audit finishes from a fresh checkpoint with zero missing,
   malformed, or mismatched objects. Its starting manifest must still match the completed import when the
   server accepts the audit; acceptance sets the durable `r2_audit_ready` finalization gate.
5. Recovery finalization succeeds and canonical production reads have passed live contract tests.
6. The production API contains every admin/read capability still needed; no job targets the private Worker.
7. A soak period has passed with no need to resume import or reconciliation.

The reconciler does not finalize automatically by default because R2 and Stamp acceptance are independent gates.
Set `RECOVERY_AUTO_FINALIZE=1` only for a controlled one-shot run after every other readiness check has passed.

Then run the host cleanup first in dry-run mode:

```sh
apps/api/ops/retire-recovery-bootstrap.sh
RECOVERY_RETIRE_CONFIRMED=yes apps/api/ops/retire-recovery-bootstrap.sh --execute
```

After host cleanup, delete the private Worker from the repository root with the pinned Wrangler dependency:

```sh
npx wrangler delete --config apps/api/wrangler.recovery.toml --force
```

Finally revoke Forge SSH key id `3016796`. Confirm normal production deployment access still works before and
after revocation. Do not delete the D1 database or R2 bucket: those are permanent recovery data stores.

## Logging and secrets

The Forge daemons log to `~/.forge/daemon-<id>.log`. Do not redirect output containing API responses into
world-readable `/tmp` files. Keep the environment file at `0600`; never copy its bearer token into a command,
unit file, repository, shell history, or cleanup log. The jobs do not intentionally log the token or fee-address
secret.

The R2 auditor checkpoints after every page and retries timeouts, rate limits, and server errors with bounded
exponential backoff. Restarting it with the same checkpoint path resumes after the last accepted transaction;
do not delete the checkpoint to work around a transient failure.

Launch it through `ops/run-recovery-r2-audit.sh`; the wrapper loads the protected environment and fixes the
working directory so the durable checkpoint cannot accidentally be created somewhere else.
