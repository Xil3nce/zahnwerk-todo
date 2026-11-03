import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging, Importance } from '@capacitor-firebase/messaging';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Store } from './store';

@Injectable({ providedIn: 'root' })
export class Push {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private listening = false;
  private token: string | null = null;

  /** Nach dem Login aufrufen; meldet das Geraet bei jedem Oeffnen neu an (haelt das Token frisch). */
  async start(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await FirebaseMessaging.createChannel({
        id: 'zahnwerk',
        name: 'Aufgaben',
        description: 'Neue, geänderte und fällige Aufgaben',
        importance: Importance.High,
      });
      const { receive } = await FirebaseMessaging.requestPermissions();
      if (receive !== 'granted') return;

      if (!this.listening) {
        this.listening = true;
        await FirebaseMessaging.addListener('tokenReceived', ({ token }) => void this.register(token));
        // Im Vordergrund zeigt Android FCM-Nachrichten nicht an; die App zeigt sie deshalb selbst.
        await FirebaseMessaging.addListener('notificationReceived', ({ notification }) => {
          void this.store.sync();
          void this.showLocal(notification.title, notification.body, notification.data);
        });
        await FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) =>
          this.open(notification.data),
        );
        await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) =>
          this.open(notification.extra),
        );
      }
      const { token } = await FirebaseMessaging.getToken();
      await this.register(token);
    } catch (error) {
      console.warn('push setup failed', error);
    }
  }

  private open(data: unknown): void {
    const todoId = (data as { todo_id?: string } | undefined)?.todo_id;
    void this.store.sync();
    void this.router.navigate(todoId ? ['/aufgabe', todoId] : ['/']);
  }

  private async showLocal(title: string | undefined, body: string | undefined, data: unknown): Promise<void> {
    if (!title && !body) return;
    try {
      await LocalNotifications.schedule({
        notifications: [{
          // Positive 31-Bit-Zahl, wie Android sie fuer Benachrichtigungs-IDs erwartet.
          id: Math.floor(Math.random() * 2_000_000_000) + 1,
          title: title ?? '',
          body: body ?? '',
          channelId: 'zahnwerk',
          smallIcon: 'ic_notification',
          extra: data,
        }],
      });
    } catch (error) {
      console.warn('local notification failed', error);
    }
  }

  private async register(token: string): Promise<void> {
    this.token = token;
    const { error } = await this.store.supabase.rpc('register_device', { p_token: token });
    if (error) console.warn('register_device failed', error.message);
  }

  async stop(): Promise<void> {
    if (!this.token) return;
    await this.store.supabase.rpc('unregister_device', { p_token: this.token });
    this.token = null;
  }
}
