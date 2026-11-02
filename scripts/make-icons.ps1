# Zeichnet App-Icon und Splash im Messing-Stil und ueberschreibt die Capacitor-Vorlagen.
Add-Type -AssemblyName System.Drawing
$res = Join-Path $PSScriptRoot '..\android\app\src\main\res'
$brass = [Drawing.ColorTranslator]::FromHtml('#c08a35')
$dark = [Drawing.ColorTranslator]::FromHtml('#5c3a10')
$leather = [Drawing.ColorTranslator]::FromHtml('#2a2017')
$parchment = [Drawing.ColorTranslator]::FromHtml('#f3e3bf')

function Draw-Gear($g, [float]$cx, [float]$cy, [float]$r) {
  $state = $g.Save()
  $g.TranslateTransform($cx, $cy)
  $fill = New-Object Drawing.SolidBrush $brass
  $line = New-Object Drawing.Pen $dark, ($r * 0.03)
  for ($i = 0; $i -lt 8; $i++) {
    $tooth = [Drawing.PointF[]]@(
      (New-Object Drawing.PointF (-0.18 * $r), (-1.0 * $r)),
      (New-Object Drawing.PointF (0.18 * $r), (-1.0 * $r)),
      (New-Object Drawing.PointF (0.26 * $r), (-0.68 * $r)),
      (New-Object Drawing.PointF (-0.26 * $r), (-0.68 * $r)))
    $g.FillPolygon($fill, $tooth)
    $g.DrawPolygon($line, $tooth)
    $g.RotateTransform(45)
  }
  $g.FillEllipse($fill, -0.75 * $r, -0.75 * $r, 1.5 * $r, 1.5 * $r)
  $g.DrawEllipse($line, -0.75 * $r, -0.75 * $r, 1.5 * $r, 1.5 * $r)
  $g.FillEllipse((New-Object Drawing.SolidBrush $parchment), -0.52 * $r, -0.52 * $r, 1.04 * $r, 1.04 * $r)
  $check = New-Object Drawing.Pen $dark, ($r * 0.15)
  $check.StartCap = 'Round'; $check.EndCap = 'Round'; $check.LineJoin = 'Round'
  $g.DrawLines($check, [Drawing.PointF[]]@(
    (New-Object Drawing.PointF (-0.27 * $r), (0.02 * $r)),
    (New-Object Drawing.PointF (-0.07 * $r), (0.22 * $r)),
    (New-Object Drawing.PointF (0.28 * $r), (-0.2 * $r))))
  $g.Restore($state)
}

function Redraw($path, [string]$mode) {
  $old = [Drawing.Image]::FromFile($path)
  $w = $old.Width; $h = $old.Height
  $old.Dispose()
  $bmp = New-Object Drawing.Bitmap $w, $h, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $min = [Math]::Min($w, $h)
  switch ($mode) {
    'foreground' { $g.Clear([Drawing.Color]::Transparent); Draw-Gear $g ($w / 2) ($h / 2) ($min * 0.30) }
    'round' {
      $g.Clear([Drawing.Color]::Transparent)
      $g.FillEllipse((New-Object Drawing.SolidBrush $leather), 0, 0, $w - 1, $h - 1)
      Draw-Gear $g ($w / 2) ($h / 2) ($min * 0.40)
    }
    'square' { $g.Clear($leather); Draw-Gear $g ($w / 2) ($h / 2) ($min * 0.42) }
    'splash' { $g.Clear($leather); Draw-Gear $g ($w / 2) ($h / 2) ($min * 0.16) }
  }
  $g.Dispose()
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Get-ChildItem $res -Recurse -Filter *.png | ForEach-Object {
  $mode = switch -Wildcard ($_.Name) {
    'ic_launcher_foreground.png' { 'foreground' }
    'ic_launcher_round.png' { 'round' }
    'ic_launcher.png' { 'square' }
    'splash.png' { 'splash' }
    default { $null }
  }
  if ($mode) { Redraw $_.FullName $mode }
}
Set-Content -Encoding utf8 (Join-Path $res 'values\ic_launcher_background.xml') @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#2A2017</color>
</resources>
'@
Set-Content -Encoding utf8 (Join-Path $res 'drawable\ic_notification.xml') @'
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M10.5,1.5h3l0.6,2.7 1.7,0.7 2.3,-1.5 2.1,2.1 -1.5,2.3 0.7,1.7 2.7,0.6v3l-2.7,0.6 -0.7,1.7 1.5,2.3 -2.1,2.1 -2.3,-1.5 -1.7,0.7 -0.6,2.7h-3l-0.6,-2.7 -1.7,-0.7 -2.3,1.5 -2.1,-2.1 1.5,-2.3 -0.7,-1.7 -2.7,-0.6v-3l2.7,-0.6 0.7,-1.7 -1.5,-2.3 2.1,-2.1 2.3,1.5 1.7,-0.7zM12,8a4,4 0,1 0,0 8a4,4 0,1 0,0 -8z" />
</vector>
'@
