# Build + signierte Release-APK. Ergebnis: dist-apk\zahnwerk-<version>.apk
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

if (-not (Test-Path 'android\app\google-services.json')) { throw 'android\app\google-services.json fehlt (siehe docs\EINRICHTUNG.md)' }
if (-not (Test-Path (Join-Path $SecretsDir 'keystore.properties'))) { throw 'Keystore fehlt: scripts\create-keystore.ps1 ausfuehren' }
if (Select-String -Path 'src\app\core\config.ts' -SimpleMatch 'DEIN-PROJEKT' -Quiet) { throw 'src\app\core\config.ts ist noch nicht ausgefuellt' }

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Web-Build fehlgeschlagen' }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync fehlgeschlagen' }

Push-Location android
try {
  .\gradlew.bat assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'Gradle-Build fehlgeschlagen' }
} finally { Pop-Location }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force dist-apk | Out-Null
$target = "dist-apk\zahnwerk-$version.apk"
Copy-Item 'android\app\build\outputs\apk\release\app-release.apk' $target -Force
Write-Output "Fertig: $target"
