import type { EventStatus } from '@gatherly/types';
import { Badge } from '../ui';

const MAP: Record<EventStatus, { tone: 'slate' | 'amber' | 'green' | 'red'; label: string }> = {
  draft: { tone: 'slate', label: 'Draft' },
  pending: { tone: 'amber', label: 'In review' },
  published: { tone: 'green', label: 'Published' },
  cancelled: { tone: 'red', label: 'Cancelled' },
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={MAP[status].tone}>{MAP[status].label}</Badge>;
}
