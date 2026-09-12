import { Compass } from 'lucide-react';
import { Page } from '../components/layout/Page';
import { ButtonLink, EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        icon={<Compass className="size-10" />}
        title="Page not found"
        description="The page you were looking for doesn't exist or has moved."
        action={<ButtonLink to="/">Go home</ButtonLink>}
      />
    </Page>
  );
}
