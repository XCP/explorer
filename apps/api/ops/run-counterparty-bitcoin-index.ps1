$ErrorActionPreference = 'Continue'
$repo = 'C:\Users\laptop\Documents\GitHub\xcp-explorer'
$script = Join-Path $repo 'apps\api\ops\build-counterparty-bitcoin-index.mjs'
$stdout = 'C:\BitcoinIndex\scanner-task.stdout.log'
$stderr = 'C:\BitcoinIndex\scanner-task.stderr.log'
Set-Location $repo
& 'C:\Program Files\nodejs\node.exe' $script `
  '--datadir=C:\BitcoinFastState' `
  '--cookie=C:\BitcoinFastState\.cookie' `
  '--rpc-url=http://127.0.0.1:8332/' `
  '--database=C:\BitcoinIndex\counterparty-bitcoin.sqlite' `
  '--end-height=959434' `
  '--batch-size=8' `
  '--commit-blocks=100' `
  '--max-bytes=10737418240' `
  *>> $stdout 2>> $stderr
exit $LASTEXITCODE
