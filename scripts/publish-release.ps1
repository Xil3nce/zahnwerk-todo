# Veroeffentlicht die gebaute APK als GitHub-Release, damit die App "Update verfuegbar" anzeigt.
# Vorher: scripts\build-apk.ps1. Ziel-Repo ist UPDATE_REPO aus src\app\core\config.ts (muss oeffentlich sein).
# Aufruf: powershell -File scripts\publish-release.ps1 [-Notes "Was ist neu"]
param([string]$Notes = '')
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$gradle = Get-Content 'android\app\build.gradle' -Raw
if ($gradle -notmatch "versionName `"$([regex]::Escape($version))`"") {
  throw "versionName in android\app\build.gradle passt nicht zu package.json ($version)"
}
$apk = "dist-apk\zahnwerk-$version.apk"
if (-not (Test-Path $apk)) { throw "$apk fehlt: zuerst scripts\build-apk.ps1 ausfuehren" }

$config = Get-Content 'src\app\core\config.ts' -Raw
if ($config -notmatch "UPDATE_REPO = '([^']+)'") { throw 'UPDATE_REPO fehlt in src\app\core\config.ts' }
$repo = $Matches[1]

if (-not $Notes) { $Notes = "Zahnwerk $version" }
$ErrorActionPreference = 'Continue'
gh release create "v$version" $apk --repo $repo --title "Zahnwerk $version" --notes $Notes
if ($LASTEXITCODE -ne 0) { throw 'gh release create fehlgeschlagen' }
Write-Output "Veroeffentlicht: v$version in $repo"
