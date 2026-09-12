import { Schema, model, type Types } from 'mongoose';

/**
 * Append-only record of privileged actions: who approved an event, who
 * refunded an order, which steward admitted which ticket. Never updated or
 * deleted by application code.
 */
export interface AuditLog {
  _id: Types.ObjectId;
  actorId: Types.ObjectId | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLog>('AuditLog', auditLogSchema);
