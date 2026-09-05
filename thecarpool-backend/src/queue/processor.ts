
interface JobPayload {
  type: 'AI_CONFIRMATION_CALL';
  data: any;
}

// A thin async runner, not a queue -- see addJob.
export class BackgroundQueue {
  private queueName: string;

  constructor(queueName: string) {
    this.queueName = queueName;
  }

  /**
   * Run a background job.
   *
   * The Redis write is gone. Every job was pushed onto a list with lPush and
   * then executed inline anyway -- and nothing, anywhere, ever popped that
   * list. It was not a queue; it was a log that grew without bound until
   * Redis ran out of memory and took the cache down with it, while the actual
   * work had already happened in-process regardless.
   *
   * Executing directly is what was happening in practice, so this is a
   * removal, not a behaviour change. A real queue means a worker that consumes
   * it, and until one exists, writing to a list nobody reads is worse than not
   * writing at all.
   */
  async addJob(jobName: string, payload: JobPayload) {
    console.log(`[JOB] ${jobName} on ${this.queueName}`);
    await this.executeJob(payload).catch(console.error);
  }

  private async executeJob(payload: JobPayload) {
    console.log(`[PROCESSING] Executing job: ${payload.type}`);
    // Only the AI confirmation call comes through here now. The push branch
    // that used to live alongside it sent to an FCM topic no client has ever
    // subscribed to, so it delivered nothing; its one caller was the SOS
    // endpoint, which now dispatches to real emergency contacts directly.
    // Every other notification in the app goes through lib/notify.
    setTimeout(() => {
      console.log(`[COMPLETED] Task done for: ${payload.type}`);
    }, 1500);
  }
}

export const aiQueue = new BackgroundQueue('thecarpool:ai_tasks');
