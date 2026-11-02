# Gemeinsame Pfade fuer die Android-Skripte. Das Java von Android Studio ist zu neu fuer Gradle 8.14.
$jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) { throw 'JDK 21 fehlt: winget install --id EclipseAdoptium.Temurin.21.JDK' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:GRADLE_USER_HOME = 'D:\Android\gradle'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
$SecretsDir = 'D:\CLAUDE\Secrets\zahnwerk-todo'
