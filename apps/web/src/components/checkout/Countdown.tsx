import { Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

export function useSecondsLeft(until: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return until ? Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000)) : 0;
}

export function Countdown({ seconds }: { seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  const urgent = seconds <= 60;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
        urgent ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800',
      )}
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
    >
      <Timer className="size-4" aria-hidden />
      Seats held for{' '}
      <span className="tabular-nums">
        {m}:{s}
      </span>
    </div>
  );
}
