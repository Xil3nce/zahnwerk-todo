package de.zahnwerk.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/**
 * Rueckmeldung der PackageInstaller-Session. Braucht die Installation eine Bestaetigung, wird der
 * Systemdialog geoeffnet (die App ist dann im Vordergrund, weil gerade "Installieren" getippt wurde).
 */
public class InstallResultReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        AppUpdaterPlugin.onInstallResult(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
    }
}
