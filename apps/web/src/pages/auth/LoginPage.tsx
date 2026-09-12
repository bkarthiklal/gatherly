import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@gatherly/types';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button, Card, Field, Input } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

/** Only same-site paths are honoured, so a crafted ?next= cannot bounce users to another site. */
export function safeNext(next: string | null, fallback = '/'): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
      await navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-center text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-center text-slate-600">
        Sign in to buy tickets and manage your events.
      </p>
      <Card className="mt-8 p-6">
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" error={errors.email?.message}>
            {(p) => <Input type="email" autoComplete="email" {...p} {...register('email')} />}
          </Field>
          <Field label="Password" error={errors.password?.message}>
            {(p) => (
              <Input
                type="password"
                autoComplete="current-password"
                {...p}
                {...register('password')}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-slate-600">
        New to Gatherly?{' '}
        <Link
          to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
