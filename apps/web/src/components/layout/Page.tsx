import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Page({
  children,
  className,
  narrow,
}: {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto px-4 py-8 sm:px-6 sm:py-10',
        narrow ? 'max-w-3xl' : 'max-w-6xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
