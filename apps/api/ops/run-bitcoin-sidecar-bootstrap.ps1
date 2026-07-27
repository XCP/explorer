$ErrorActionPreference = 'Stop'
$root = 'C:\Users\laptop\Documents\GitHub\xcp-explorer'
$log = 'C:\BitcoinIndex\bitcoin-sidecar-bootstrap.log'
$from = 298319
$target = 959434
$chunk = 10000
Set-Location $root
while ($from -le $target) {
  $to = [Math]::Min($target, $from + $chunk - 1)
  $sql = ".codex-tmp/import-bitcoin-sidecar-$from-$to.sql"
  Add-Content $log "$(Get-Date -Format o) START $from-$to"
  & node apps/api/ops/export-bitcoin-sidecar-sql.mjs "--from=$from" "--to=$to" "--output=$sql" *>> $log
  if ($LASTEXITCODE -ne 0) { Add-Content $log "$(Get-Date -Format o) EXPORT_FAILED $from-$to"; exit $LASTEXITCODE }
  & node node_modules/wrangler/bin/wrangler.js d1 execute xcpio-btc --remote "--file=$sql" *>> $log
  if ($LASTEXITCODE -ne 0) { Add-Content $log "$(Get-Date -Format o) IMPORT_FAILED $from-$to"; exit $LASTEXITCODE }
  Add-Content $log "$(Get-Date -Format o) COMPLETE $from-$to"
  Remove-Item -LiteralPath $sql -Force -ErrorAction SilentlyContinue
  $from = $to + 1
}
Add-Content $log "$(Get-Date -Format o) COMPLETE_ALL"
