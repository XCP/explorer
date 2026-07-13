param(
  [Parameter(Mandatory = $true)]
  [string]$Cli,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$WranglerArgs
)

& node $Cli @WranglerArgs
exit $LASTEXITCODE
