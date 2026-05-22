import { redisClient } from '../server';

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
    } else {
      console.warn(`[QUEUE] Redis unavailable, bypassing queue for job: ${jobName}`);
      // Fallback synchronous execution
      this.processJobSynchronously(payload);
    }
  }

  private processJobSynchronously(payload: JobPayload) {
    console.log(`[FALLBACK] Processing job synchronously: ${payload.type}`);
    // Simulate intensive AI or notification task execution
    setTimeout(() => {
      console.log(`[COMPLETED] Synchronous task done for: ${payload.type}`);
    }, 1500);
  }
}

export const aiQueue = new BackgroundQueue('thecarpool:ai_tasks');
export const notificationsQueue = new BackgroundQueue('thecarpool:notifications');
