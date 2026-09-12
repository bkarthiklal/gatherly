import type { CheckoutSession } from '@gatherly/types';

type RazorpaySession = Extract<CheckoutSession, { kind: 'razorpay' }>;

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(
    event: 'payment.failed',
    handler: (response: { error: { description: string } }) => void,
  ): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load Razorpay Checkout. Check your connection and try again.'));
    };
    document.body.appendChild(script);
  });
  return loading;
}

/**
 * Opens Razorpay's hosted checkout. Card and UPI details are entered inside
 * Razorpay's own frame and never touch this page or our server — which is
 * why the platform falls under PCI DSS SAQ A.
 */
export async function openRazorpayCheckout(
  session: RazorpaySession,
  handlers: {
    onSuccess: (r: RazorpaySuccess) => void;
    onDismiss: () => void;
    onFailure: (message: string) => void;
  },
): Promise<void> {
  await loadScript();
  if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable');

  const checkout = new window.Razorpay({
    key: session.keyId,
    order_id: session.razorpayOrderId,
    amount: session.amountMinor,
    currency: session.currency,
    name: session.name,
    description: session.description,
    prefill: session.prefill,
    theme: { color: '#4f46e5' },
    handler: handlers.onSuccess,
    modal: { ondismiss: handlers.onDismiss, confirm_close: true },
  });
  checkout.on('payment.failed', (r) => handlers.onFailure(r.error.description));
  checkout.open();
}
