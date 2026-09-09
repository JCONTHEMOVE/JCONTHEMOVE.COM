export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
  onClick?: () => void;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

class PushNotificationService {
  private swRegistration: ServiceWorkerRegistration | null = null;
  private subscriptionPending: Promise<boolean> | null = null;
  lastPushError: string | null = null;

  isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  }

  getPermissionStatus(): NotificationPermission {
    if (!this.isSupported()) return 'denied';
    return Notification.permission;
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await this.subscribeToServerPush();
      }
      return permission;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return 'denied';
    }
  }

  async getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (this.swRegistration) return this.swRegistration;
    if (!('serviceWorker' in navigator)) return null;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        this.swRegistration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Service worker timed out.')), 10000); }),
        ]);
      } finally { clearTimeout(timer); }
      return this.swRegistration;
    } catch {
      return null;
    }
  }

  subscribeToServerPush(): Promise<boolean> {
    if (!this.subscriptionPending) {
      this.subscriptionPending = this.registerServerPush().finally(() => { this.subscriptionPending = null; });
    }
    return this.subscriptionPending;
  }

  private async registerServerPush(): Promise<boolean> {
    try {
      this.lastPushError = null;
      if (!this.isSupported() || Notification.permission !== 'granted') throw new Error('Browser push is unsupported or permission has not been granted.');
      const configResponse = await fetch('/api/notifications/vapid-public-key', { cache: 'no-store' });
      if (!configResponse.ok) throw new Error('Server push configuration is not ready. Ask the owner to check push readiness.');
      const { publicKey } = await configResponse.json();
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      if (applicationServerKey.length !== 65 || applicationServerKey[0] !== 4) throw new Error('Server returned an invalid push public key.');
      const registration = await this.getSwRegistration();
      if (!registration) throw new Error('Service worker is unavailable.');

      let subscription = await registration.pushManager.getSubscription();
      const existingKey = subscription?.options.applicationServerKey;
      if (subscription && (!existingKey || new Uint8Array(existingKey).length !== applicationServerKey.length ||
        !new Uint8Array(existingKey).every((value, index) => value === applicationServerKey[index]))) {
        if (!await subscription.unsubscribe()) throw new Error('Could not replace the old push subscription. Retry enabling notifications.');
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...subscription.toJSON(), applicationServerKey: publicKey }),
      });

      if (!res.ok) throw new Error(`Could not save push subscription (${res.status}). Sign in and retry enabling notifications.`);
      return true;
    } catch (error) {
      this.lastPushError = error instanceof Error ? error.message : 'Push subscription failed.';
      console.warn(this.lastPushError);
      return false;
    }
  }

  async showLocalNotification(options: NotificationOptions): Promise<void> {
    if (!this.isSupported()) return;
    if (Notification.permission !== 'granted') return;

    try {
      const registration = await this.getSwRegistration();
      if (registration) {
        const notificationOptions: globalThis.NotificationOptions = {
          body: options.body,
          icon: options.icon || '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          tag: options.tag,
          requireInteraction: options.requireInteraction ?? false,
          data: { url: '/rewards' },
        };
        await registration.showNotification(options.title, notificationOptions);
      } else {
        new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/favicon.ico',
          tag: options.tag,
        });
      }
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  }

  async notifyMiningComplete(tokensEarned: number): Promise<void> {
    await this.showLocalNotification({
      title: '⛏️ Mining Session Complete!',
      body: `You earned ${tokensEarned.toLocaleString()} JCMOVES tokens. Tap to claim your rewards!`,
      tag: 'mining-complete',
      requireInteraction: true,
    });
  }

  async notifyCanClaim(accumulatedTokens: number): Promise<void> {
    await this.showLocalNotification({
      title: '🪙 Tokens Ready to Claim!',
      body: `${accumulatedTokens.toLocaleString()} JCMOVES are waiting for you. Tap to claim now!`,
      tag: 'mining-ready',
      requireInteraction: true,
    });
  }

  async notifyNewReward(rewardType: string, amount: number): Promise<void> {
    await this.showLocalNotification({
      title: '🎉 New Reward Available!',
      body: `You received ${amount.toLocaleString()} JCMOVES for ${rewardType}`,
      tag: 'new-reward',
    });
  }

  async notifyStreakBonus(streakCount: number, bonusAmount: number): Promise<void> {
    await this.showLocalNotification({
      title: `🔥 ${streakCount}-Day Streak!`,
      body: `Streak bonus: +${bonusAmount.toLocaleString()} JCMOVES! Keep it going!`,
      tag: 'streak-bonus',
    });
  }

  async notifyDailyCheckInReady(): Promise<void> {
    await this.showLocalNotification({
      title: '📅 Daily Rewards Ready!',
      body: "Your daily mining rewards are ready to claim. Don't break your streak!",
      tag: 'daily-checkin',
      requireInteraction: true,
    });
  }
}

export const notificationService = new PushNotificationService();
