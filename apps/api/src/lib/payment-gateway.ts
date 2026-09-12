import Razorpay from 'razorpay';
import { ERROR_CODES } from '@gatherly/types';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * The slice of Razorpay the application uses, behind an interface so tests
 * run against a fake and nothing else in the codebase imports the SDK.
 */
export interface PaymentGateway {
  readonly keyId: string;
  createOrder(input: {
    amountMinor: number;
    currency: 'INR';
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
  refund(input: {
    paymentId: string;
    amountMinor: number;
    notes: Record<string, string>;
  }): Promise<{ id: string; status: string }>;
  listRefunds(
    paymentId: string,
  ): Promise<{ id: string; status: string; notes: Record<string, string | number> }[]>;
}

class RazorpayGateway implements PaymentGateway {
  private readonly client: Razorpay;

  constructor(
    readonly keyId: string,
    keySecret: string,
  ) {
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  async createOrder(input: Parameters<PaymentGateway['createOrder']>[0]) {
    const order = await this.client.orders.create({
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    });
    return { id: order.id };
  }

  async refund(input: Parameters<PaymentGateway['refund']>[0]) {
    const refund = await this.client.payments.refund(input.paymentId, {
      amount: input.amountMinor,
      speed: 'normal',
      notes: input.notes,
    });
    return { id: refund.id, status: refund.status };
  }

  async listRefunds(paymentId: string) {
    const result = await this.client.payments.fetchMultipleRefund(paymentId, { count: 100 });
    return result.items.map((r) => ({
      id: r.id,
      status: r.status,
      notes: (Array.isArray(r.notes) ? {} : r.notes) as Record<string, string | number>,
    }));
  }
}

let gateway: PaymentGateway | undefined;

export function getPaymentGateway(): PaymentGateway {
  if (gateway) return gateway;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(
      503,
      ERROR_CODES.PAYMENT_FAILED,
      'Payments are not configured on this server',
    );
  }
  gateway = new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET);
  return gateway;
}

/** Test seam. */
export function setPaymentGateway(replacement: PaymentGateway | undefined): void {
  gateway = replacement;
}
