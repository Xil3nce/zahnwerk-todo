# Zahnwerk – gemeinsame ToDo-App (Android)

App auf Deutsch, Sideload-APK für zwei Personen, keine kostenpflichtigen Dienste.

## Stack
- Angular 22, Capacitor 8 (minSdk 24, target 36), kein Ionic
- Lokal: Dexie (IndexedDB) mit Outbox; Backend: Supabase Free (Postgres, Auth, RLS, Edge Functions, pg_cron)
- Push: `@capacitor-firebase/messaging`, Versand aus `supabase/functions/push-dispatch` über FCM HTTP v1
- `firebase` JS bleibt auf 12.x (Peer des Plugins)

## Befehle
- `npm test` – Unit-Tests (Vitest)
- `npm run build` – Web-Build
- `powershell -File scripts/build-apk.ps1` – signierte Release-APK
- `npx supabase db push` – Migrationen einspielen
- `npx supabase functions deploy push-dispatch --no-verify-jwt`
- `npm run test:db` – Migrationen, RLS, Sync, Pushes in PGlite
- `powershell -File scripts/publish-release.ps1` – APK als GitHub-Release an `UPDATE_REPO` (Selbst-Update-Hinweis)

## Konventionen
- Schema nur über neue Dateien in `supabase/migrations/`; nie alte Migrationen ändern.
- Clients schreiben Aufgabendaten nur über `sync_push`; `server_seq` ist der Pull-Cursor, nicht `updated_at`.
- Last-write-wins: pro Feld bei `todos`, pro Datensatz bei `subtasks`/`categories`; Kommentare unveränderlich.
- Kategorien und Unteraufgaben immer als vollständigen Datensatz in die Outbox schreiben.
- `due_date` ist ein reines Datum nach Europe/Berlin; Logik in `src/app/core/due.ts`.
- `assignee_id = null` bedeutet „Beide“.
- `bucket`: `null` = normale Aufgabe, `idea` = Ideen-Parkplatz (nicht in „Alle“); `later` ist Altbestand der früheren Ablage „Später“ und wird wie `null` behandelt (seit 1.0.7 kein Reiter mehr, stattdessen „Wichtig“ = offene Aufgaben mit `important`).
- `due_window` (`week`/`month`): Zeitfenster; `due_date` ist dann das Fensterende, Folgeaufgaben rasten per `private.snap_window` ein.
- Ruhezeiten 22–7 Uhr (Europe/Berlin) pro Profil (`quiet_hours`): `claim_notifications` hält zurück, morgens eine Sammelmeldung (`kind = 'digest'`).
- Papierkorb: `deleted_at` bleibt 30 Tage wiederherstellbar; `private.cleanup()` löscht danach endgültig.
- Vorlagen (`templates`, ab 1.0.8): ganzer Datensatz LWW wie Kategorien, `items` = Checkliste (max. 100 Texte); „Starten“ legt clientseitig Aufgabe + Unteraufgaben in einer Transaktion an, keine Verknüpfung auf dem Server.
- „Ich hab Zeit“ (`/zeit`): `suggestForTime` in `views.ts`, nur Aufgaben mit `effort_minutes`; Rang überfällig → heute → wichtig → Woche → später → ohne Datum.
- Selbst-Update (ab 1.1.0) wie Vorrat: `AppUpdaterPlugin.java` lädt die Release-APK in den App-Cache (fester Name) und installiert per PackageInstaller-Session; Release-Asset heißt immer `zahnwerk.apk`.
- Spracheingabe: `@capgo/capacitor-speech-recognition` (v8 passt zu Capacitor 8).
- Farben und Abstände nur über CSS-Variablen in `src/styles.scss`.

## Secrets
Nie committen, nie im Chat wiederholen: Service-Account-JSON, Keystore, Passwörter, `google-services.json`.
Keystore und Key liegen unter `D:\CLAUDE\Secrets\zahnwerk-todo\`.
