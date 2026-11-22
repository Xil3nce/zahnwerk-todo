# Veroeffentlicht die gebaute APK als GitHub-Release, damit die App "Update verfuegbar" anzeigt.
# Vorher: scripts\build-apk.ps1. Ziel-Repo ist UPDATE_REPO aus src\app\core\config.ts (muss oeffentlich sein).
# Aufruf: powershell -File scripts\publish-release.ps1 [-Notes "Was ist neu" | -NotesFile notizen.txt]
# Text mit Anfuehrungszeichen immer per -NotesFile (UTF-8): "powershell -File" zerteilt ihn sonst.
# Ohne PositionalBinding bricht ein zerteilter -Notes-Text ab, statt gekuerzt veroeffentlicht zu werden.
[CmdletBinding(PositionalBinding = $false)]
param([string]$Notes = '', [string]$NotesFile = '')
$ErrorActionPreference = 'Stop'
if ($NotesFile) {
  if ($Notes) { throw 'Nur -Notes oder -NotesFile angeben, nicht beides.' }
  # Vor Set-Location lesen (relativer Pfad) und streng als UTF-8 (sonst kaputte Umlaute).
  $path = (Resolve-Path -LiteralPath $NotesFile).ProviderPath
  $Notes = [IO.File]::ReadAllText($path, (New-Object Text.UTF8Encoding $false, $true)).Trim()
  if (-not $Notes) { throw "$NotesFile ist leer." }
}
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
# Immer derselbe Dateiname im Release ("zahnwerk.apk"): Ein Download von Hand ersetzt so die alte Datei,
# statt jedes Mal eine weitere abzulegen. Die App selbst laedt in ihren Cache (AppUpdaterPlugin).
$upload = Join-Path $root 'dist-apk\upload'
New-Item -ItemType Directory -Force $upload | Out-Null
$fixed = Join-Path $upload 'zahnwerk.apk'
Copy-Item $apk $fixed -Force
# Als Datei uebergeben: PowerShell 5.1 verliert Anfuehrungszeichen in Argumenten an gh.
$notesTemp = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($notesTemp, $Notes)
  gh release create "v$version" $fixed --repo $repo --title "Zahnwerk $version" --notes-file $notesTemp
  if ($LASTEXITCODE -ne 0) { throw 'gh release create fehlgeschlagen' }
} finally {
  Remove-Item -LiteralPath $notesTemp -Force
}
Write-Output "Veroeffentlicht: v$version in $repo"
