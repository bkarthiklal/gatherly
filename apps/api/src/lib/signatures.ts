import { createHmac, timingSafeEqual } from 'node:crypto';

function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Constant-time comparison. `a === b` returns as soon as a character
 * differs, so an attacker measuring response times could recover a valid
 * signature one character at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Razorpay signs each webhook delivery with HMAC-SHA256 over the exact raw
 * request bytes. It must be the raw bytes: re-serialising parsed JSON can
 * reorder keys or change whitespace and the signature would no longer match.
 */
export function verifyRazorpayWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  return safeEqual(hmacHex(secret, rawBody), signature);
}

/**
 * Razorpay Checkout returns `razorpay_signature` =
 * HMAC-SHA256(key_secret, `${razorpay_order_id}|${razorpay_payment_id}`).
 * Only Razorpay and this server know the key secret, so a matching signature
 * proves the payment really succeeded for that order.
 */
export function verifyRazorpayPayment(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  return safeEqual(hmacHex(keySecret, `${razorpayOrderId}|${razorpayPaymentId}`), signature);
}

export const TICKET_QR_VERSION = 'GTH1';

/**
 * A ticket's QR code carries `GTH1.<ticketId>.<serial>.<signature>`, where the
 * signature is HMAC-SHA256 over the ticket id, serial and event id with a
 * server-only secret.
 *
 * Forging a ticket, or editing a real one to point at another event, needs
 * the secret. Copying a genuine QR (a screenshot shared with a friend) still
 * produces a valid signature — that case is stopped at the door by the
 * single-use check, which admits whichever copy is scanned first.
 */
export function signTicket(
  secret: string,
  ticketId: string,
  serial: string,
  eventId: string,
): string {
  return createHmac('sha256', secret)
    .update(`${ticketId}.${serial}.${eventId}`)
    .digest('base64url');
}

export function ticketQrPayload(
  secret: string,
  ticketId: string,
  serial: string,
  eventId: string,
): string {
  return `${TICKET_QR_VERSION}.${ticketId}.${serial}.${signTicket(secret, ticketId, serial, eventId)}`;
}

export interface ParsedTicketQr {
  ticketId: string;
  serial: string;
  signature: string;
}

export function parseTicketQr(payload: string): ParsedTicketQr | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 4 || parts[0] !== TICKET_QR_VERSION) return null;
  const [, ticketId, serial, signature] = parts as [string, string, string, string];
  if (
    !/^[0-9a-f]{24}$/.test(ticketId) ||
    !/^[A-Z0-9-]{6,32}$/.test(serial) ||
    !/^[\w-]{43}$/.test(signature)
  ) {
    return null;
  }
  return { ticketId, serial, signature };
}
