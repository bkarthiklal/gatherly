import { wireProducers } from './jobs/workers.js';
import type { QueueRegistry } from './jobs/queues.js';

/**
 * Connects side-effect subscribers (job scheduling, notifications, refunds,
 * real-time broadcasts) to domain events. Called once per process at boot —
 * never by `createApp`, so tests exercise pure request handling unless they
 * opt in.
 */
export function registerAppModules(registry: QueueRegistry): void {
  wireProducers(registry);
}
