import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<{ id: string }>;
}

class ResendTransport implements EmailTransport {
  private readonly client: Resend;
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage) {
    const { data, error } = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.attachments
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
            })),
          }
        : {}),
    });
    // Throwing lets the queue retry with backoff instead of losing the email.
    if (error || !data)
      throw new Error(`Resend rejected email: ${error?.message ?? 'no response'}`);
    return { id: data.id };
  }
}

/** Development and test transport: records messages and logs a summary instead of sending. */
export class MemoryTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage) {
    this.sent.push(message);
    logger.info(
      {
        to: message.to,
        subject: message.subject,
        attachments: message.attachments?.map((a) => a.filename),
      },
      'Email (not sent — RESEND_API_KEY not set)',
    );
    return Promise.resolve({ id: `memory-${this.sent.length}` });
  }
}

let transport: EmailTransport | undefined;

export function getEmailTransport(): EmailTransport {
  transport ??= env.RESEND_API_KEY
    ? new ResendTransport(env.RESEND_API_KEY)
    : new MemoryTransport();
  return transport;
}

export function setEmailTransport(replacement: EmailTransport | undefined): void {
  transport = replacement;
}
