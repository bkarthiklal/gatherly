import { subscribe } from './lib/domain-events.js';
import { QUEUE_NAMES, type QueueRegistry } from './jobs/queues.js';
import { registerProcessor, wireProducers } from './jobs/workers.js';
import { sendTicketEmail } from './services/notification.service.js';
import { processRefund, refundCancelledEvent } from './services/refund.service.js';

/**
 * Connects side-effect subscribers (job scheduling, notifications, refunds,
 * real-time broadcasts) to domain events and registers job processors.
 * Called once per process at boot — never by `createApp`, so tests exercise
 * pure request handling unless they opt in.
 */
export function registerAppModules(registry: QueueRegistry): void {
  wireProducers(registry);

  registerProcessor(QUEUE_NAMES.notifications, async (job) => {
    const { orderId } = job.data as { orderId: string };
    return { result: await sendTicketEmail(orderId) };
  });
  registerProcessor(QUEUE_NAMES.refunds, async (job) => {
    const { refundId } = job.data as { refundId: string };
    return { status: await processRefund(refundId) };
  });

  subscribe('order.paid', async ({ orderId }) => {
    await registry.get(QUEUE_NAMES.notifications).add(
      'ticket-email',
      { orderId },
      {
        jobId: `ticket-email-${orderId}`,
        attempts: 6,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );
  });

  subscribe('refund.requested', async ({ refundId }) => {
    await registry.get(QUEUE_NAMES.refunds).add(
      'refund',
      { refundId },
      // Gateway outages can last minutes; back off up to roughly an hour across attempts.
      { jobId: `refund-${refundId}`, attempts: 8, backoff: { type: 'exponential', delay: 30_000 } },
    );
  });

  subscribe('event.cancelled', async ({ eventId }) => {
    await refundCancelledEvent(eventId);
  });
}
