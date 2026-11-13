package de.zahnwerk.todo;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Selbst-Update wie in der Vorrat-App: laedt die APK des GitHub-Releases in den App-Cache
 * (immer dieselbe Datei, nichts landet in "Downloads") und uebergibt sie dem System-Installer.
 * Android installiert nur, wenn Paketname und Signatur zur installierten App passen.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String TAG = "AppUpdater";
    private static final String FILE_NAME = "zahnwerk-update.apk";
    private static volatile AppUpdaterPlugin instance;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false;

    @Override
    public void load() {
        instance = this;
    }

    /** Darf Zahnwerk Pakete installieren ("Unbekannte Apps installieren")? */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", allowed());
        call.resolve(result);
    }

    /** Oeffnet die Systemeinstellung, in der Zahnwerk das Installieren erlaubt wird. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()))
            : new Intent(Settings.ACTION_SECURITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Einstellung nicht gefunden", "settings", e);
        }
    }

    /**
     * Laedt die APK (url, optional apiUrl als Ausweichweg und size in Bytes) und startet die Installation.
     * Fortschritt kommt als Ereignis "progress" ({ value: 0..1 oder -1 }), das Ergebnis des Installers
     * als Ereignis "installStatus".
     */
    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        String apiUrl = call.getString("apiUrl");
        long size = call.getLong("size", 0L);
        if (url == null || !url.startsWith("https://")) {
            call.reject("Keine gültige Download-Adresse", "download");
            return;
        }
        if (busy) {
            call.reject("Update läuft bereits", "busy");
            return;
        }
        busy = true;
        executor.execute(() -> {
            File apk;
            try {
                apk = download(url, apiUrl, size);
            } catch (Exception e) {
                Log.w(TAG, "Download fehlgeschlagen", e);
                busy = false;
                call.reject("Download fehlgeschlagen", "download", e);
                return;
            }
            try {
                commitSession(apk);
                call.resolve();
            } catch (Exception e) {
                Log.w(TAG, "Installation konnte nicht gestartet werden", e);
                call.reject("Installation konnte nicht gestartet werden", "install", e);
            } finally {
                busy = false;
            }
        });
    }

    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private File download(String url, String apiUrl, long size) throws IOException {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cache nicht beschreibbar");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        File target = new File(dir, FILE_NAME);

        List<String[]> attempts = new ArrayList<>();
        attempts.add(new String[] { url, null });
        if (apiUrl != null && apiUrl.startsWith("https://api.github.com/")) attempts.add(new String[] { apiUrl, "application/octet-stream" });

        IOException last = null;
        for (String[] attempt : attempts) {
            try {
                downloadTo(attempt[0], attempt[1], size, target);
                return target;
            } catch (IOException e) {
                Log.w(TAG, "Download über " + Uri.parse(attempt[0]).getHost() + " fehlgeschlagen", e);
                target.delete();
                last = e;
            }
        }
        throw last != null ? last : new IOException("Keine Download-Adresse");
    }

    private void downloadTo(String address, String accept, long size, File target) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        if (accept != null) connection.setRequestProperty("Accept", accept);
        try {
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("Download " + code);
            long total = size > 0 ? size : connection.getContentLengthLong();
            long done = 0;
            int lastPercent = -1;
            emitProgress(total > 0 ? 0 : -1);
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    out.write(buffer, 0, read);
                    done += read;
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            emitProgress(Math.min(1.0, (double) done / total));
                        }
                    }
                }
            }
            if (size > 0 && done != size) throw new IOException("Unvollständig: " + done + " von " + size + " Bytes");
        } finally {
            connection.disconnect();
        }
    }

    private void emitProgress(double value) {
        JSObject data = new JSObject();
        data.put("value", value);
        notifyListeners("progress", data);
    }

    private void commitSession(File apk) throws IOException {
        Context context = getContext();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Ab der zweiten Selbst-Installation darf Android die Rueckfrage weglassen; beim ersten Mal fragt es.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (OutputStream out = session.openWrite("zahnwerk.apk", 0, apk.length()); InputStream in = new FileInputStream(apk)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) out.write(buffer, 0, read);
                session.fsync(out);
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent callback = PendingIntent.getBroadcast(
                context, sessionId, new Intent(context, InstallResultReceiver.class), flags);
            session.commit(callback.getIntentSender());
        } catch (Exception e) {
            installer.abandonSession(sessionId);
            throw new IOException("Installation konnte nicht gestartet werden", e);
        } finally {
            // Die Session hat ihre eigene Kopie; die Datei im Cache wird nicht mehr gebraucht.
            apk.delete();
        }
    }

    /** Aufruf aus {@link InstallResultReceiver}. Bei Erfolg ersetzt Android ohnehin den Prozess. */
    static void onInstallResult(int status, String message) {
        AppUpdaterPlugin plugin = instance;
        if (plugin == null) return;
        String kind;
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: kind = "pending"; break;
            case PackageInstaller.STATUS_SUCCESS: kind = "success"; break;
            case PackageInstaller.STATUS_FAILURE_ABORTED: kind = "aborted"; break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: kind = "conflict"; break;
            default: kind = "failed";
        }
        if (!"pending".equals(kind) && !"success".equals(kind)) Log.w(TAG, "Installation: " + status + " " + message);
        JSObject data = new JSObject();
        data.put("status", kind);
        data.put("message", message);
        plugin.notifyListeners("installStatus", data);
    }
}
