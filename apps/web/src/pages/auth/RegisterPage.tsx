import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@gatherly/types';
import { CalendarPlus, Ticket } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { Alert, Button, Card, Field, Input } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { safeNext } from './LoginPage';

type RegisterForm = z.input<typeof registerSchema>;

export function RegisterPage() {
  const { register: signUp, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: params.get('role') === 'organiser' ? 'organiser' : 'attendee' },
  });
  const role = watch('role');

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await signUp(registerSchema.parse(values));
      const fallback = created.role === 'organiser' ? '/organiser' : '/events';
      await navigate(safeNext(params.get('next'), fallback), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const roles = [
    {
      value: 'attendee' as const,
      title: 'I want to attend',
      body: 'Find events and buy tickets',
      icon: Ticket,
    },
    {
      value: 'organiser' as const,
      title: 'I organise events',
      body: 'Create events and sell tickets',
      icon: CalendarPlus,
    },
  ];

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-center text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 text-center text-slate-600">It takes less than a minute.</p>
      <Card className="mt-8 p-6">
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Account type</legend>
            <div className="grid grid-cols-2 gap-3">
              {roles.map((r) => (
                <label
                  key={r.value}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1 rounded-lg p-3 ring-1 ring-inset transition',
                    role === r.value
                      ? 'bg-brand-50 ring-2 ring-brand-500'
                      : 'ring-slate-300 hover:bg-slate-50',
                  )}
                >
                  <input
                    type="radio"
                    value={r.value}
                    checked={role === r.value}
                    onChange={() => setValue('role', r.value)}
                    className="sr-only"
                  />
                  <r.icon
                    className={cn('size-5', role === r.value ? 'text-brand-600' : 'text-slate-400')}
                    aria-hidden
                  />
                  <span className="text-sm font-medium">{r.title}</span>
                  <span className="text-xs text-slate-500">{r.body}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Full name" error={errors.name?.message}>
            {(p) => <Input autoComplete="name" {...p} {...register('name')} />}
          </Field>
          <Field label="Email" error={errors.email?.message}>
            {(p) => <Input type="email" autoComplete="email" {...p} {...register('email')} />}
          </Field>
          <Field
            label="Password"
            error={errors.password?.message}
            hint="At least 12 characters. A short phrase works well."
          >
            {(p) => (
              <Input type="password" autoComplete="new-password" {...p} {...register('password')} />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Create account
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}
