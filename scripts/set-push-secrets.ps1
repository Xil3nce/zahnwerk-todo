# Setzt die Function-Secrets und traegt URL und Push-Secret in den Vault ein.
# Gibt keine Geheimnisse aus. Vorher: npx.cmd supabase login und npx.cmd supabase link.
param([Parameter(Mandatory)][string]$ProjectUrl)
$ErrorActionPreference = 'Stop'
$keyFile = Get-ChildItem 'D:\CLAUDE\Secrets\zahnwerk-todo' -Filter '*.json' | Select-Object -First 1
if (-not $keyFile) { throw 'Service-Account-JSON fehlt in D:\CLAUDE\Secrets\zahnwerk-todo' }

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pushSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$account = (Get-Content $keyFile.FullName -Raw | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 5)
$url = $ProjectUrl.TrimEnd('/')

$envFile = Join-Path $env:TEMP "zahnwerk-$([guid]::NewGuid()).env"
$sqlFile = Join-Path $env:TEMP "zahnwerk-$([guid]::NewGuid()).sql"
try {
  "PUSH_SECRET=$pushSecret`nFCM_SERVICE_ACCOUNT='$account'" | Set-Content -Encoding ascii $envFile
  npx.cmd supabase secrets set --env-file $envFile
  if ($LASTEXITCODE -ne 0) { throw 'secrets set fehlgeschlagen' }

  # Anlegen oder ersetzen, damit das Skript erneut laufen kann.
  @"
do `$`$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'zahnwerk_project_url';
  if v_id is null then perform vault.create_secret('$url', 'zahnwerk_project_url');
  else perform vault.update_secret(v_id, '$url'); end if;
  select id into v_id from vault.secrets where name = 'zahnwerk_push_secret';
  if v_id is null then perform vault.create_secret('$pushSecret', 'zahnwerk_push_secret');
  else perform vault.update_secret(v_id, '$pushSecret'); end if;
end
`$`$;
"@ | Set-Content -Encoding ascii $sqlFile
  npx.cmd supabase db query --linked -f $sqlFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Vault-Eintrag fehlgeschlagen' }
} finally {
  Remove-Item $envFile, $sqlFile -Force -ErrorAction SilentlyContinue
}
Write-Output 'Function-Secrets und Vault gesetzt.'
