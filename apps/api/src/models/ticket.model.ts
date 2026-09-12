import { TICKET_STATUSES, type TicketStatus } from '@gatherly/types';
import { Schema, model, type Types } from 'mongoose';

/** One document per seat. The QR signature is derived on demand, never stored. */
export interface Ticket {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  eventId: Types.ObjectId;
  tierId: Types.ObjectId;
  userId: Types.ObjectId;
  tierName: string;
  attendeeName: string;
  /** Human-readable, unique. Printed on the ticket for manual lookup at the door. */
  serial: string;
  status: TicketStatus;
  checkedInAt: Date | null;
  checkedInBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ticketSchema = new Schema<Ticket>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    tierId: { type: Schema.Types.ObjectId, ref: 'TicketTier', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tierName: { type: String, required: true },
    attendeeName: { type: String, required: true },
    serial: { type: String, required: true, unique: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'valid', required: true },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

ticketSchema.index({ userId: 1, createdAt: -1 });
ticketSchema.index({ orderId: 1 });
ticketSchema.index({ eventId: 1, status: 1 });

export const TicketModel = model<Ticket>('Ticket', ticketSchema);
