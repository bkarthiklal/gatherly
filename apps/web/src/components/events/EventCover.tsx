import type { EventCategory } from '@gatherly/types';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { CATEGORY_GRADIENTS, CATEGORY_LABELS } from '../../lib/format';
import { cn } from '../../lib/cn';

/** Banner image, or a category gradient when there is none (or it fails to load). */
export function EventCover({
  bannerUrl,
  category,
  title,
  className,
  showTitle = true,
}: {
  bannerUrl: string | null;
  category: EventCategory;
  title: string;
  className?: string;
  /** Off where the title is already printed next to the cover. */
  showTitle?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (bannerUrl && !failed) {
    return (
      <img
        src={bannerUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'relative flex size-full items-end bg-gradient-to-br p-4',
        CATEGORY_GRADIENTS[category],
        className,
      )}
      aria-hidden
    >
      <CalendarDays className="absolute right-4 top-4 size-8 text-white/30" />
      {showTitle && (
        <span className="line-clamp-2 text-lg font-bold leading-tight text-white/95 drop-shadow-sm">
          {title}
          <span className="mt-1 block text-xs font-medium uppercase tracking-wider text-white/70">
            {CATEGORY_LABELS[category]}
          </span>
        </span>
      )}
    </div>
  );
}
