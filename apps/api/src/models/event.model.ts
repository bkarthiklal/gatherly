import {
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  type EventCategory,
  type EventStatus,
} from '@gatherly/types';
import { Schema, model, type Types } from 'mongoose';

export interface EventVenue {
  name: string;
  addressLine: string;
  city: string;
  /** Lower-cased copy of `city` for exact, case-insensitive filtering. */
  cityKey: string;
  location?: { type: 'Point'; coordinates: [number, number] };
}

export interface Event {
  _id: Types.ObjectId;
  organiserId: Types.ObjectId;
  title: string;
  slug: string;
  description: string;
  category: EventCategory;
  venue: EventVenue;
  startsAt: Date;
  endsAt: Date;
  bannerUrl: string | null;
  status: EventStatus;
  rejectionReason: string | null;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const venueSchema = new Schema<EventVenue>(
  {
    name: { type: String, required: true },
    addressLine: { type: String, required: true },
    city: { type: String, required: true },
    cityKey: { type: String, required: true },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined },
    },
  },
  { _id: false },
);

const eventSchema = new Schema<Event>(
  {
    organiserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    category: { type: String, enum: EVENT_CATEGORIES, required: true },
    venue: { type: venueSchema, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    bannerUrl: { type: String, default: null },
    status: { type: String, enum: EVENT_STATUSES, default: 'draft', required: true },
    rejectionReason: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Public listing: published, upcoming, soonest first.
eventSchema.index({ status: 1, startsAt: 1 });
eventSchema.index({ status: 1, 'venue.cityKey': 1, startsAt: 1 });
// Organiser dashboard.
eventSchema.index({ organiserId: 1, createdAt: -1 });
// Keyword search. Title matches weigh more than description matches.
eventSchema.index(
  { title: 'text', description: 'text' },
  { weights: { title: 5, description: 1 } },
);
eventSchema.index({ 'venue.location': '2dsphere' }, { sparse: true });

export const EventModel = model<Event>('Event', eventSchema);
