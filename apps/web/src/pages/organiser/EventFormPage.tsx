import { zodResolver } from '@hookform/resolvers/zod';
import {
  EVENT_CATEGORIES,
  type CreateEventInput,
  type OrganiserEvent,
  type UpdateEventInput,
} from '@gatherly/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { RequireAuth } from '../../components/layout/guards';
import { Page } from '../../components/layout/Page';
import { BannerUpload } from '../../components/organiser/BannerUpload';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { CATEGORY_LABELS, fromLocalInput, toLocalInput } from '../../lib/format';
import { keys, organiserEventQuery } from '../../lib/queries';

const rupees = z
  .string()
  .trim()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 499 or 499.50');
const wholeNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, 'Whole number')
    .refine((v) => Number(v) >= min && Number(v) <= max, `Between ${min} and ${max}`);

const tierSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(60),
  price: rupees,
  quantityTotal: wholeNumber(1, 1_000_000),
  perUserLimit: wholeNumber(1, 20),
});

const formSchema = z
  .object({
    title: z.string().trim().min(4, 'At least 4 characters').max(140),
    description: z.string().trim().min(20, 'Tell attendees a bit more (20+ characters)').max(5000),
    category: z.enum(EVENT_CATEGORIES),
    venueName: z.string().trim().min(2, 'Required').max(120),
    addressLine: z.string().trim().min(4, 'Required').max(200),
    city: z.string().trim().min(2, 'Required').max(80),
    startsAt: z.string().min(1, 'Required'),
    endsAt: z.string().min(1, 'Required'),
    bannerUrl: z.union([z.literal(''), z.url('Must be a full https:// URL')]),
    tiers: z.array(tierSchema).max(10),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: 'Must be after the start',
    path: ['endsAt'],
  });

type FormValues = z.infer<typeof formSchema>;

const toMinor = (price: string) => Math.round(Number(price) * 100);

function defaultsFrom(event?: OrganiserEvent): FormValues {
  if (!event) {
    return {
      title: '',
      description: '',
      category: 'music',
      venueName: '',
      addressLine: '',
      city: '',
      startsAt: '',
      endsAt: '',
      bannerUrl: '',
      tiers: [{ name: 'General admission', price: '499', quantityTotal: '100', perUserLimit: '6' }],
    };
  }
  return {
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venue.name,
    addressLine: event.venue.addressLine,
    city: event.venue.city,
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    bannerUrl: event.bannerUrl ?? '',
    tiers: [],
  };
}

function EventForm({ event }: { event?: OrganiserEvent }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const editing = !!event;
  const structuralLocked = editing && event.status !== 'draft';

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(
      formSchema.refine((v) => editing || v.tiers.length > 0, {
        message: 'Add at least one ticket type',
        path: ['tiers'],
      }),
    ),
    defaultValues: defaultsFrom(event),
  });
  const tiers = useFieldArray({ control, name: 'tiers' });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const venue = { name: v.venueName, addressLine: v.addressLine, city: v.city };
    try {
      if (!editing) {
        const body: CreateEventInput = {
          title: v.title,
          description: v.description,
          category: v.category,
          venue,
          startsAt: fromLocalInput(v.startsAt),
          endsAt: fromLocalInput(v.endsAt),
          ...(v.bannerUrl ? { bannerUrl: v.bannerUrl } : {}),
          tiers: v.tiers.map((t) => ({
            name: t.name,
            priceMinor: toMinor(t.price),
            currency: 'INR',
            quantityTotal: Number(t.quantityTotal),
            perUserLimit: Number(t.perUserLimit),
          })),
        };
        const created = await api<OrganiserEvent>('/organiser/events', { method: 'POST', body });
        await queryClient.invalidateQueries({ queryKey: keys.organiserEvents });
        await navigate(`/organiser/events/${created.id}`, { replace: true });
        return;
      }

      // Send only what changed: structural fields are refused once an event is submitted, even if unchanged.
      const body: UpdateEventInput = {
        ...(dirtyFields.title ? { title: v.title } : {}),
        ...(dirtyFields.description ? { description: v.description } : {}),
        ...(dirtyFields.bannerUrl ? { bannerUrl: v.bannerUrl || null } : {}),
        ...(dirtyFields.category ? { category: v.category } : {}),
        ...(dirtyFields.venueName || dirtyFields.addressLine || dirtyFields.city ? { venue } : {}),
        ...(dirtyFields.startsAt ? { startsAt: fromLocalInput(v.startsAt) } : {}),
        ...(dirtyFields.endsAt ? { endsAt: fromLocalInput(v.endsAt) } : {}),
      };
      if (Object.keys(body).length > 0) {
        await api<OrganiserEvent>(`/organiser/events/${event.id}`, { method: 'PATCH', body });
      }
      await queryClient.invalidateQueries({ queryKey: keys.organiserEvent(event.id) });
      await navigate(`/organiser/events/${event.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-6" noValidate>
      {error && <Alert>{error}</Alert>}
      {structuralLocked && (
        <Alert tone="blue">
          Date, venue and category are locked after submission. To change them, cancel this event
          and create a new one.
        </Alert>
      )}

      <Card className="space-y-5 p-6">
        <h2 className="font-semibold">Basics</h2>
        <Field label="Title" error={errors.title?.message}>
          {(p) => (
            <Input {...p} {...register('title')} placeholder="e.g. Indiranagar Indie Nights" />
          )}
        </Field>
        <Field label="Description" error={errors.description?.message}>
          {(p) => (
            <Textarea
              rows={6}
              {...p}
              {...register('description')}
              placeholder="What should attendees expect?"
            />
          )}
        </Field>
        <Field label="Category" error={errors.category?.message}>
          {(p) => (
            <Select {...p} {...register('category')} disabled={structuralLocked}>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Banner image</p>
          <Controller
            control={control}
            name="bannerUrl"
            render={({ field }) => <BannerUpload value={field.value} onChange={field.onChange} />}
          />
          <Field label="…or paste an image URL" error={errors.bannerUrl?.message} className="mt-3">
            {(p) => <Input {...p} {...register('bannerUrl')} placeholder="https://" />}
          </Field>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <h2 className="font-semibold">When and where</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts (IST)" error={errors.startsAt?.message}>
            {(p) => (
              <Input
                type="datetime-local"
                {...p}
                {...register('startsAt')}
                disabled={structuralLocked}
              />
            )}
          </Field>
          <Field label="Ends (IST)" error={errors.endsAt?.message}>
            {(p) => (
              <Input
                type="datetime-local"
                {...p}
                {...register('endsAt')}
                disabled={structuralLocked}
              />
            )}
          </Field>
        </div>
        <Field label="Venue name" error={errors.venueName?.message}>
          {(p) => <Input {...p} {...register('venueName')} disabled={structuralLocked} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Address" error={errors.addressLine?.message}>
            {(p) => <Input {...p} {...register('addressLine')} disabled={structuralLocked} />}
          </Field>
          <Field label="City" error={errors.city?.message}>
            {(p) => <Input {...p} {...register('city')} disabled={structuralLocked} />}
          </Field>
        </div>
      </Card>

      {!editing && (
        <Card className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Ticket types</h2>
            <Button
              variant="secondary"
              size="sm"
              disabled={tiers.fields.length >= 10}
              onClick={() =>
                tiers.append({ name: '', price: '', quantityTotal: '', perUserLimit: '4' })
              }
            >
              <Plus className="size-4" aria-hidden /> Add type
            </Button>
          </div>
          {errors.tiers?.message && <p className="text-sm text-red-600">{errors.tiers.message}</p>}
          {errors.tiers?.root?.message && (
            <p className="text-sm text-red-600">{errors.tiers.root.message}</p>
          )}
          {tiers.fields.map((f, i) => (
            <div
              key={f.id}
              className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-start"
            >
              <Field label="Name" error={errors.tiers?.[i]?.name?.message}>
                {(p) => <Input {...p} {...register(`tiers.${i}.name`)} placeholder="General" />}
              </Field>
              <Field label="Price (₹)" error={errors.tiers?.[i]?.price?.message}>
                {(p) => (
                  <Input
                    inputMode="decimal"
                    {...p}
                    {...register(`tiers.${i}.price`)}
                    placeholder="0 for free"
                  />
                )}
              </Field>
              <Field label="Capacity" error={errors.tiers?.[i]?.quantityTotal?.message}>
                {(p) => (
                  <Input inputMode="numeric" {...p} {...register(`tiers.${i}.quantityTotal`)} />
                )}
              </Field>
              <Field label="Max / person" error={errors.tiers?.[i]?.perUserLimit?.message}>
                {(p) => (
                  <Input inputMode="numeric" {...p} {...register(`tiers.${i}.perUserLimit`)} />
                )}
              </Field>
              <button
                type="button"
                onClick={() => tiers.remove(i)}
                disabled={tiers.fields.length === 1}
                className="mt-7 rounded-lg p-2 text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-30"
                aria-label={`Remove ticket type ${i + 1}`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            "Max / person" caps how many one account can buy — the main defence against bulk-buying
            for resale.
          </p>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void navigate(-1)}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {editing ? 'Save changes' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}

function EditEvent() {
  const { eventId = '' } = useParams();
  const { data, isPending, error } = useQuery(organiserEventQuery(eventId));
  if (isPending) return <Spinner label="Loading event" />;
  if (error) return <Alert title="Couldn't load this event">{errorMessage(error)}</Alert>;
  return <EventForm event={data} />;
}

export function NewEventPage() {
  return (
    <RequireAuth roles={['organiser', 'admin']}>
      <Page narrow>
        <PageHeader
          title="Create an event"
          description="Saved as a draft. Submit it for review when you're ready."
        />
        <EventForm />
      </Page>
    </RequireAuth>
  );
}

export function EditEventPage() {
  return (
    <RequireAuth roles={['organiser', 'admin']}>
      <Page narrow>
        <PageHeader title="Edit event" />
        <EditEvent />
      </Page>
    </RequireAuth>
  );
}
