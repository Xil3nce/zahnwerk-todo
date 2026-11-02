# Erzeugt einmalig den Release-Keystore ausserhalb des Repos. Bricht ab, wenn schon einer existiert.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')
$store = Join-Path $SecretsDir 'zahnwerk-release.jks'
$props = Join-Path $SecretsDir 'keystore.properties'
if (Test-Path $store) { throw "Keystore existiert bereits: $store" }
New-Item -ItemType Directory -Force $SecretsDir | Out-Null

$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', 'x'

# keytool schreibt Statusmeldungen auf stderr; das darf hier nicht als Fehler gelten.
$ErrorActionPreference = 'Continue'
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $store -storetype PKCS12 -alias zahnwerk `
  -keyalg RSA -keysize 4096 -validity 36500 -storepass $password -keypass $password `
  -dname 'CN=Zahnwerk, O=Privat, C=DE' 2>$null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { throw 'keytool fehlgeschlagen' }

@"
storeFile=$($store -replace '\\', '/')
storePassword=$password
keyAlias=zahnwerk
keyPassword=$password
"@ | Set-Content -Encoding ascii $props
Write-Output "Keystore angelegt in $SecretsDir. Bitte extern sichern."
