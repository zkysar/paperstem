import { randomUUID } from 'node:crypto';
import { stmts } from './db.js';

export type AuditAction =
  | 'project.soft_delete'
  | 'project.purge'
  | 'stem.soft_delete'
  | 'stem.purge'
  | 'stem.purge_cascade'
  | 'annotation.hard_delete';

export type AuditResourceType = 'project' | 'stem' | 'annotation';

export type AuditActor = {
  id: string;
  email?: string | null;
} | null;

export type AuditInput = {
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string;
  actor: AuditActor;
  band_id: string | null;
  metadata?: Record<string, unknown>;
};

export function recordAudit(input: AuditInput): void {
  const id = randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const actorId = input.actor?.id ?? null;
  const actorEmail = input.actor?.email ?? null;

  try {
    stmts.insertAuditLog.run(
      id,
      createdAt,
      actorId,
      actorEmail,
      input.action,
      input.resource_type,
      input.resource_id,
      input.band_id,
      metadataJson,
    );
  } catch (err) {
    console.error('[audit] db insert failed', {
      action: input.action,
      resource_id: input.resource_id,
      err,
    });
  }

  console.log(
    JSON.stringify({
      type: 'audit',
      id,
      ts: createdAt,
      action: input.action,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      user_id: actorId,
      user_email: actorEmail,
      band_id: input.band_id,
      metadata: input.metadata ?? null,
    }),
  );
}
