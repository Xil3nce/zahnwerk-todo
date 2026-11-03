# Installiert die Android-SDK-Pakete. Zeigt die Lizenzen an: sie muessen von dir bestaetigt werden.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')
sdkmanager --sdk_root=$env:ANDROID_HOME --licenses
if ($LASTEXITCODE -ne 0) { throw 'Lizenzen wurden nicht bestaetigt' }
sdkmanager --sdk_root=$env:ANDROID_HOME 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0'
if ($LASTEXITCODE -ne 0) { throw 'SDK-Installation fehlgeschlagen' }
# Der sdkmanager meldet auch bei abgelehnten Lizenzen Erfolg, deshalb das Ergebnis selbst pruefen.
foreach ($dir in 'platform-tools', 'platforms\android-36', 'build-tools\35.0.0') {
  if (-not (Test-Path (Join-Path $env:ANDROID_HOME $dir))) { throw "Nicht installiert: $dir. Wurden alle Lizenzen mit y bestaetigt?" }
}
Write-Output 'Android SDK ist bereit.'
