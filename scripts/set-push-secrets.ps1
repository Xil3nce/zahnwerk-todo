# Setzt die Function-Secrets und legt das SQL fuer den Vault in die Zwischenablage.
# Gibt keine Geheimnisse aus. Vorher: npx supabase login und npx supabase link.
param([Parameter(Mandatory)][string]$ProjectUrl)
$ErrorActionPreference = 'Stop'
$keyFile = Get-ChildItem 'D:\CLAUDE\Secrets\zahnwerk-todo' -Filter '*.json' | Select-Object -First 1
if (-not $keyFile) { throw 'Service-Account-JSON fehlt in D:\CLAUDE\Secrets\zahnwerk-todo' }

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pushSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$account = (Get-Content $keyFile.FullName -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 5)

$envFile = Join-Path $env:TEMP "zahnwerk-$([guid]::NewGuid()).env"
try {
  "PUSH_SECRET=$pushSecret`nFCM_SERVICE_ACCOUNT='$account'" | Set-Content -Encoding ascii $envFile
  npx supabase secrets set --env-file $envFile
  if ($LASTEXITCODE -ne 0) { throw 'secrets set fehlgeschlagen' }
} finally {
  Remove-Item $envFile -Force -ErrorAction SilentlyContinue
}

Set-Clipboard @"
select vault.create_secret('$($ProjectUrl.TrimEnd('/'))', 'zahnwerk_project_url');
select vault.create_secret('$pushSecret', 'zahnwerk_push_secret');
"@
Write-Output 'Secrets gesetzt. Das Vault-SQL liegt in der Zwischenablage: im Supabase SQL Editor einfuegen und ausfuehren.'
