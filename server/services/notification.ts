import webpush from 'web-push';
import { storage } from '../storage';
import type { InsertNotification } from '@shared/schema';
import { pushConfig } from './pushConfig';

if (pushConfig.ready) {
  webpush.setVapidDetails(pushConfig.subject, pushConfig.publicKey, pushConfig.privateKey);
} else {
  console.warn('[PushNotification] Disabled:', pushConfig.blockers.join(' '));
}

export interface NotificationData {
  userId: string;
  type: 'quote_request' | 'crew_opportunity' | 'crew_selected' | 'job_assigned' | 'job_status_change' | 'jcmoves_pending' | 'upcoming_job_reminder' | 'new_message' | 'system_alert' | 'mining_complete' | 'reward_available';
  title: string;
  message: string;
  data?: any;
}

export type NotificationDeliveryResult = {
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
};

export type NotificationSendResult = {
  inApp: NotificationDeliveryResult;
  push: NotificationDeliveryResult;
};

export class NotificationService {
  private vapidReady = pushConfig.ready;

  async createNotification(notificationData: NotificationData): Promise<NotificationDeliveryResult> {
    try {
      const insertData: InsertNotification = {
        userId: notificationData.userId,
        type: notificationData.type as any,
        title: notificationData.title,
        message: notificationData.message,
        data: notificationData.data,
      };
      await storage.createNotification(insertData);
      return { status: 'sent' };
    } catch (error) {
      console.error('Error creating notification:', error);
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async sendPushNotification(
    userId: string,
    notification: { title: string; body: string; tag?: string; requireInteraction?: boolean; data?: any }
  ): Promise<NotificationDeliveryResult> {
    if (!this.vapidReady) {
      return { status: 'skipped', error: pushConfig.blockers.join(' ') };
    }
    try {
      const user = await storage.getUser(userId);
      if (!user?.pushSubscription) {
        return { status: 'skipped', error: 'Recipient has not enabled browser push notifications.' };
      }

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        tag: notification.tag || 'jcmove-notification',
        requireInteraction: notification.requireInteraction ?? false,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        data: { url: '/rewards', ...(notification.data || {}) },
      });

      await webpush.sendNotification(user.pushSubscription as webpush.PushSubscription, payload, { timeout: 10000, TTL: 300 });
      console.log(`[PushNotification] Sent to user ${userId}: ${notification.title}`);
      return { status: 'sent' };
    } catch (error: any) {
      if (error?.statusCode === 410 || error?.statusCode === 404) {
        // Subscription expired — clear it
        await storage.updateUserPushSubscription(userId, null as any);
        console.log(`[PushNotification] Cleared expired subscription for ${userId}`);
        return { status: 'failed', error: 'Recipient browser push subscription expired and was removed.' };
      } else {
        console.error('[PushNotification] Error sending push:', error?.message || error);
        return { status: 'failed', error: error?.message || String(error) };
      }
    }
  }

  async sendNotification(notificationData: NotificationData): Promise<NotificationSendResult> {
    const inApp = await this.createNotification(notificationData);
    const push = await this.sendPushNotification(notificationData.userId, {
      title: notificationData.title,
      body: notificationData.message,
      data: notificationData.data,
    });
    return { inApp, push };
  }

  // Mining / rewards push helpers
  async notifyMiningComplete(userId: string, tokensEarned: number): Promise<void> {
    await this.sendPushNotification(userId, {
      title: '⛏️ Mining Session Complete!',
      body: `${tokensEarned.toLocaleString()} JCMOVES are ready to claim. Tap to collect!`,
      tag: 'mining-complete',
      requireInteraction: true,
      data: { url: '/rewards', type: 'mining_complete' },
    });
    await this.createNotification({
      userId,
      type: 'mining_complete',
      title: '⛏️ Mining Session Complete!',
      message: `${tokensEarned.toLocaleString()} JCMOVES are ready to claim.`,
      data: { type: 'mining_complete', tokens: tokensEarned },
    });
  }

  async notifyRewardAvailable(userId: string, rewardType: string, amount: number): Promise<void> {
    const label = rewardType.replace(/_/g, ' ');
    await this.sendPushNotification(userId, {
      title: '🎉 New Reward Available!',
      body: `You earned ${amount.toLocaleString()} JCMOVES for ${label}`,
      tag: 'reward-available',
      data: { url: '/rewards', type: 'reward_available' },
    });
    await this.createNotification({
      userId,
      type: 'reward_available',
      title: '🎉 New Reward Available!',
      message: `You earned ${amount.toLocaleString()} JCMOVES for ${label}`,
      data: { type: 'reward_available', rewardType, amount },
    });
  }

  // Existing helpers (jobs, alerts)
  async notifyJobAssigned(userId: string, jobId: string, customerName: string): Promise<void> {
    await this.sendNotification({
      userId,
      type: 'job_assigned',
      title: 'New Job Assigned',
      message: `You've been assigned a new job for ${customerName}`,
      data: { jobId, type: 'job_assigned' },
    });
  }

  async notifyJobStatusChange(userId: string, jobId: string, status: string, customerName: string): Promise<void> {
    await this.sendNotification({
      userId,
      type: 'job_status_change',
      title: 'Job Status Updated',
      message: `Job for ${customerName} is now ${status}`,
      data: { jobId, status, type: 'job_status_change' },
    });
  }

  async notifySystemAlert(userId: string, title: string, message: string): Promise<void> {
    await this.sendNotification({
      userId,
      type: 'system_alert',
      title,
      message,
      data: { type: 'system_alert' },
    });
  }

  async notifyAllEmployees(title: string, message: string, data?: any): Promise<void> {
    try {
      const employees = await storage.getEmployees();
      for (const employee of employees) {
        await this.sendNotification({
          userId: employee.id,
          type: 'system_alert',
          title,
          message,
          data,
        });
      }
    } catch (error) {
      console.error('Error notifying all employees:', error);
    }
  }
}

export const notificationService = new NotificationService();
