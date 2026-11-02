# Einrichtung (einmalig)

Passwörter und Schlüssel nie in den Chat oder ins Repo schreiben. Alle Befehle im Ordner `zahnwerk-todo` ausführen.

## 1. Android SDK
```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-sdk.ps1
```
Lizenzen lesen und mit `y` bestätigen.

## 2. Supabase-Projekt
1. Auf [supabase.com](https://supabase.com) registrieren, Projekt in der Region Frankfurt anlegen, Datenbank-Passwort im Passwort-Manager speichern. **Verlangt Supabase eine Karte: abbrechen.**
2. *Authentication → Sign In / Providers*: „Allow new users to sign up“ ausschalten.
3. *Authentication → Users → Add user*: beide Konten mit E-Mail und Passwort anlegen, E-Mail automatisch bestätigen.
4. Project URL und Publishable Key in `src/app/core/config.ts` eintragen.
5. Verbinden und Schema einspielen:
```powershell
npx supabase login
npx supabase link --project-ref DEINE-PROJECT-REF
npx supabase db push
```
6. Im *SQL Editor* ausführen (E-Mail-Adressen anpassen):
```sql
select private.bootstrap_household('Haushalt', 'freddy@example.com', 'Freddy', 'melina@example.com', 'Melina');
```

## 3. Firebase (Spark)
1. In der [Firebase Console](https://console.firebase.google.com) ein Projekt anlegen, Analytics aus, Spark-Plan beibehalten.
2. Android-App mit Paketname `de.zahnwerk.todo` hinzufügen, `google-services.json` nach `android/app/` legen.
3. *Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren*, Datei nach `D:\CLAUDE\Secrets\zahnwerk-todo\` legen.
4. Secrets setzen und Function veröffentlichen:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\set-push-secrets.ps1 -ProjectUrl https://DEINE-REF.supabase.co
npx supabase functions deploy push-dispatch --no-verify-jwt
```
5. Das SQL aus der Zwischenablage im *SQL Editor* ausführen.

## 4. Keep-alive
Im GitHub-Repo unter *Settings → Secrets and variables → Actions* anlegen: `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY`. Danach unter *Actions → Supabase Keep-alive → Run workflow* einmal testen.

## 5. APK bauen
```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
```

## Wenn das Projekt doch pausiert
Supabase schickt etwa eine Woche vorher eine Warnmail. Pausiert es, im Dashboard das Projekt öffnen und *Resume project* wählen. Die App funktioniert in der Zwischenzeit offline weiter; Pushes und Erinnerungen fallen aus.

## Backup
Der Free-Plan hat keine automatischen Backups. Gelegentlich sichern (das Ziel liegt außerhalb des Repos):
```powershell
npx supabase db dump --data-only -f D:\CLAUDE\Secrets\zahnwerk-todo\backup.sql
```
