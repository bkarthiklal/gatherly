import type { EventCategory } from '@gatherly/types';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Paise → "₹1,499" (whole rupees) or "₹1,499.50". */
export function formatMoney(minor: number): string {
  if (minor === 0) return 'Free';
  return minor % 100 === 0 ? inrWhole.format(minor / 100) : inr.format(minor / 100);
}

/** Amounts that are totals rather than prices: ₹0 instead of "Free". */
export function formatAmount(minor: number): string {
  return minor % 100 === 0 ? inrWhole.format(minor / 100) : inr.format(minor / 100);
}

export function formatMoneyExact(minor: number): string {
  return inr.format(minor / 100);
}

const IST = 'Asia/Kolkata';

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: IST,
  }).format(new Date(iso));
}

export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: IST,
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', timeZone: IST }).format(
    new Date(iso),
  );
}

export function dateBadge(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: IST }).format(d),
    month: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: IST })
      .format(d)
      .toUpperCase(),
  };
}

/** "YYYY-MM-DDTHH:mm" in IST for <input type="datetime-local"> and back. */
export function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: IST,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

export function fromLocalInput(value: string): string {
  // Organisers enter times in IST regardless of the browser's timezone.
  return new Date(`${value}:00+05:30`).toISOString();
}

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  music: 'Music',
  tech: 'Tech',
  sports: 'Sports',
  arts: 'Arts',
  community: 'Community',
  education: 'Education',
  other: 'Other',
};

/** Covers for events without a banner, so the grid never shows broken images. */
export const CATEGORY_GRADIENTS: Record<EventCategory, string> = {
  music: 'from-fuchsia-500 via-purple-500 to-indigo-600',
  tech: 'from-sky-500 via-cyan-500 to-teal-500',
  sports: 'from-orange-500 via-amber-500 to-yellow-400',
  arts: 'from-rose-500 via-pink-500 to-fuchsia-500',
  community: 'from-emerald-500 via-green-500 to-lime-500',
  education: 'from-blue-600 via-indigo-500 to-violet-500',
  other: 'from-slate-600 via-slate-500 to-slate-400',
};

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
