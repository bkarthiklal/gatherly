import { Schema, model, type Types } from 'mongoose';

/**
 * Razorpay delivers webhooks at least once — it retries until it gets a 2xx,
 * and can deliver the same event more than once even after one. The unique
 * index on the event id is the whole idempotency mechanism: recording the id
 * and applying the effect happen in one transaction, so a duplicate delivery
 * either hits the index and is skipped, or the first delivery rolled back
 * and this one does the work. It can never be applied twice.
 */
export interface ProcessedWebhook {
  _id: Types.ObjectId;
  eventId: string;
  type: string;
  receivedAt: Date;
}

const processedWebhookSchema = new Schema<ProcessedWebhook>({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  receivedAt: { type: Date, required: true, default: () => new Date() },
});

// Razorpay stops retrying long before 30 days, so older ids can go.
processedWebhookSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const ProcessedWebhookModel = model<ProcessedWebhook>(
  'ProcessedWebhook',
  processedWebhookSchema,
);
