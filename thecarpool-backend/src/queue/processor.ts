import { redisClient } from '../server';
import * as admin from 'firebase-admin';

interface JobPayload {
  type: 'AI_CONFIRMATION_CALL' | 'EMERGENCY_SOS' | 'PUSH_NOTIFICATION';
  data: any;
}

// Mock BullMQ Queue implementation using simple Redis Lists for background async tasks
export class BackgroundQueue {
  private queueName: string;

  constructor(queueName: string) {
    this.queueName = queueName;
  }

  async addJob(jobName: string, payload: JobPayload) {
    if (redisClient.isOpen) {
      await redisClient.lPush(this.queueName, JSON.stringify({ jobName, payload, timestamp: Date.now() }));
      console.log(`[QUEUE] Added background job: ${jobName} to ${this.queueName}`);
      
      // For this implementation, we will synchronously trigger processing immediately after queueing
      // In production with BullMQ, a separate worker process would consume this list.
      this.executeJob(payload).catch(console.error);
    } else {
      console.warn(`[QUEUE] Redis unavailable, bypassing queue for job: ${jobName}`);
      // Fallback synchronous execution
      this.executeJob(payload).catch(console.error);
    }
  }

  private async executeJob(payload: JobPayload) {
    console.log(`[PROCESSING] Executing job: ${payload.type}`);
    
    if (payload.type === 'EMERGENCY_SOS' || payload.type === 'PUSH_NOTIFICATION') {
      try {
        const title = payload.type === 'EMERGENCY_SOS' ? '🚨 SOS Alert!' : 'CarPool Notification';
        const body = payload.type === 'EMERGENCY_SOS' 
          ? `Emergency triggered by user ${payload.data.user_id}` 
          : payload.data.message || 'You have a new update concerning your ride.';
        
        // In a full production scenario, we'd lookup the user's registered FCM device tokens from Firestore:
        // const userDoc = await admin.firestore().collection('users').doc(String(payload.data.user_id)).get();
        // const token = userDoc.data()?.fcm_token;
        // Here we simulate by pushing to a topic dedicated to the user.
        const topic = `user_${payload.data.user_id || 'broadcast'}`;
        
        await admin.messaging().send({
          notification: { title, body },
          topic
        });
        console.log(`[FCM] Firebase Push Notification sent to topic "${topic}"`);
      } catch (err) {
        console.error('[FCM] Failed to send push notification:', err);
      }
    } else {
      // Simulate intensive AI or other task execution
      setTimeout(() => {
        console.log(`[COMPLETED] Task done for: ${payload.type}`);
      }, 1500);
    }
  }
}

export const aiQueue = new BackgroundQueue('thecarpool:ai_tasks');
export const notificationsQueue = new BackgroundQueue('thecarpool:notifications');
