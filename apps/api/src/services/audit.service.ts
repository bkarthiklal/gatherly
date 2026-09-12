import type { AuditLog as AuditLogDto, AuditQuery, Paginated } from '@gatherly/types';
import type { Request } from 'express';
import { logger } from '../lib/logger.js';
import { AuditLogModel } from '../models/audit-log.model.js';
import { UserModel } from '../models/user.model.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Writes an audit record. A failure to audit is logged but does not undo the
 * action it describes — the action has already committed, and failing the
 * response would only make the caller retry something that succeeded.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
      ip: entry.ip ?? null,
    });
  } catch (err) {
    logger.error({ err, entry }, 'Failed to write audit log');
  }
}

export function auditFromRequest(
  req: Request,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return audit({
    actorId: req.auth?.userId ?? null,
    action,
    targetType,
    targetId,
    metadata,
    ip: req.ip ?? null,
  });
}

export async function listAuditLogs(query: AuditQuery): Promise<Paginated<AuditLogDto>> {
  const filter = query.action ? { action: query.action } : {};
  const skip = (query.page - 1) * query.limit;
  const [logs, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  const actors = await UserModel.find({
    _id: { $in: logs.flatMap((l) => (l.actorId ? [l.actorId] : [])) },
  })
    .select('name')
    .lean();
  const names = new Map(actors.map((a) => [a._id.toString(), a.name]));

  return {
    items: logs.map((l) => ({
      id: l._id.toString(),
      actor: l.actorId
        ? { id: l.actorId.toString(), name: names.get(l.actorId.toString()) ?? 'Deleted user' }
        : null,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      metadata: l.metadata,
      ip: l.ip,
      createdAt: l.createdAt.toISOString(),
    })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
