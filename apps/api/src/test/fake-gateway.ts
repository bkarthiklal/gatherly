import type { PaymentGateway } from '../lib/payment-gateway.js';

/** In-memory stand-in for Razorpay that records every call. */
export class FakeGateway implements PaymentGateway {
  readonly keyId = 'rzp_test_dummy';
  readonly ordersCreated: { id: string; amountMinor: number; receipt: string }[] = [];
  readonly refundsIssued: {
    id: string;
    paymentId: string;
    amountMinor: number;
    notes: Record<string, string>;
  }[] = [];
  refundStatus = 'processed';
  failNextRefund = false;

  createOrder(input: Parameters<PaymentGateway['createOrder']>[0]) {
    const id = `order_fake${this.ordersCreated.length + 1}`;
    this.ordersCreated.push({ id, amountMinor: input.amountMinor, receipt: input.receipt });
    return Promise.resolve({ id });
  }

  refund(input: Parameters<PaymentGateway['refund']>[0]) {
    if (this.failNextRefund) {
      this.failNextRefund = false;
      return Promise.reject(new Error('Gateway timeout'));
    }
    const id = `rfnd_fake${this.refundsIssued.length + 1}`;
    this.refundsIssued.push({ id, ...input });
    return Promise.resolve({ id, status: this.refundStatus });
  }

  listRefunds(paymentId: string) {
    return Promise.resolve(
      this.refundsIssued
        .filter((r) => r.paymentId === paymentId)
        .map((r) => ({ id: r.id, status: this.refundStatus, notes: r.notes })),
    );
  }
}
