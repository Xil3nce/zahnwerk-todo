# Installiert die Android-SDK-Pakete. Zeigt die Lizenzen an: sie muessen von dir bestaetigt werden.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')
sdkmanager --sdk_root=$env:ANDROID_HOME --licenses
if ($LASTEXITCODE -ne 0) { throw 'Lizenzen wurden nicht bestaetigt' }
sdkmanager --sdk_root=$env:ANDROID_HOME 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0'
if ($LASTEXITCODE -ne 0) { throw 'SDK-Installation fehlgeschlagen' }
Write-Output 'Android SDK ist bereit.'
