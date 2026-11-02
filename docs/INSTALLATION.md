# Installation auf den Handys

Die Menüs heißen je nach Hersteller etwas anders.

## Erstinstallation
1. `dist-apk\zahnwerk-<version>.apk` aufs Handy kopieren, z. B. per USB oder Cloud-Speicher.
2. Die Datei in der App „Dateien“ antippen.
3. Android fragt nach der Erlaubnis, aus dieser Quelle zu installieren: *Einstellungen* öffnen, „Dieser Quelle vertrauen“ aktivieren, zurück und *Installieren* wählen.
4. Warnt Google Play Protect vor einer unbekannten App: *Trotzdem installieren*.
5. App öffnen, anmelden, Benachrichtigungen erlauben.

## Damit Pushes zuverlässig ankommen
- Die App **nie** über *App-Info → Beenden erzwingen* stoppen: Danach kommen keine Pushes, bis sie wieder von Hand geöffnet wird.
- Kommen Pushes nur beim Öffnen an: *App-Info → Akku* auf „Nicht eingeschränkt“ stellen.

## Updates
1. Am Rechner neu bauen. Vorher `version` in `package.json` sowie `versionCode` (immer höher) und `versionName` in `android/app/build.gradle` erhöhen.
2. Die neue APK wie oben installieren. Die Daten bleiben erhalten.

Das geht nur mit demselben Keystore. **Den Ordner `D:\CLAUDE\Secrets\zahnwerk-todo` extern sichern**, z. B. verschlüsselt im Passwort-Manager. Geht er verloren, muss die App neu installiert werden; nicht übertragene Änderungen wären dann weg.
