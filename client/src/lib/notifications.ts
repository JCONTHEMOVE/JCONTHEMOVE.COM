export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
  onClick?: () => void;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export class PushNotificationService {
  private swRegistration: ServiceWorkerRegistration | null = null;
  private subscriptionAttempt: Promise<boolean> | null = null;

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
      this.swRegistration = await navigator.serviceWorker.ready;
      return this.swRegistration;
    } catch {
      return null;
    }
  }

  subscribeToServerPush(): Promise<boolean> {
    if (!this.isSupported() || Notification.permission !== 'granted') {
      return Promise.resolve(false);
    }
    // Permission prompts and mount effects can both request enrollment.
    if (!this.subscriptionAttempt) {
      this.subscriptionAttempt = this.syncServerPush().finally(() => {
        this.subscriptionAttempt = null;
      });
    }
    return this.subscriptionAttempt;
  }

  private async syncServerPush(): Promise<boolean> {
    const controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // Read the runtime key before touching a working browser subscription.
      const keyResponse = await fetch('/api/notifications/vapid-public-key', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!keyResponse.ok) return false;
      const { publicKey } = await keyResponse.json();
      if (typeof publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(publicKey)) return false;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      // Web Push uses an uncompressed P-256 public key.
      if (applicationServerKey.length !== 65 || applicationServerKey[0] !== 4) return false;

      const registration = await Promise.race([
        this.getSwRegistration(),
        new Promise<null>((resolve) => {
          if (controller.signal.aborted) resolve(null);
          else controller.signal.addEventListener('abort', () => resolve(null), { once: true });
        }),
      ]);
      if (!registration || controller.signal.aborted || Notification.permission !== 'granted') return false;

      // Native PushManager operations cannot be cancelled. Once migration
      // starts, do not let the discovery deadline strand an unsubscribed user.
      clearTimeout(timeout);

      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const existingKey = subscription.options.applicationServerKey;
        const bytes = existingKey ? new Uint8Array(existingKey) : null;
        const matches = bytes?.length === applicationServerKey.length &&
          applicationServerKey.every((byte, index) => bytes[index] === byte);
        if (!matches) {
          if (!await subscription.unsubscribe()) return false;
          subscription = null;
        }
      }
      if (controller.signal.aborted || Notification.permission !== 'granted') return false;
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      const registrationController = new AbortController();
      timeout = setTimeout(() => registrationController.abort(), 15000);
      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: registrationController.signal,
        body: JSON.stringify(subscription.toJSON()),
      });

      return res.ok;
    } catch {
      // Avoid logging subscription endpoints or provider payloads.
      console.warn('Browser push enrollment failed; retry when connected.');
      return false;
    } finally {
      clearTimeout(timeout);
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
