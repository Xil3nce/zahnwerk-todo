import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging, Importance } from '@capacitor-firebase/messaging';
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
        // Im Vordergrund zeigt Android nichts an; die Liste aktualisiert sich stattdessen.
        await FirebaseMessaging.addListener('notificationReceived', () => void this.store.sync());
        await FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => {
          const todoId = (notification.data as { todo_id?: string } | undefined)?.todo_id;
          void this.store.sync();
          void this.router.navigate(todoId ? ['/aufgabe', todoId] : ['/']);
        });
      }
      const { token } = await FirebaseMessaging.getToken();
      await this.register(token);
    } catch (error) {
      console.warn('push setup failed', error);
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
