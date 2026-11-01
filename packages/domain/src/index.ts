import { and, desc, eq } from "drizzle-orm";
import {
  type AppDatabase,
  type DbExecutor,
  auditLogs,
  outboxEvents,
  outboxDeliveries,
  idempotencyKeys
} from "@agrotrade/db";
import {
  AppError,
  createCorrelationId,
  createUuidV7,
  sha256Hex
} from "@agrotrade/shared";

export const DOMAIN_EVENT_TYPES = [
  "PRODUCT_APPROVED",
  "PRODUCT_UPDATED",
  "PRODUCT_ARCHIVED",
  "PRICE_CHANGED",
  "STOCK_CHANGED",
  "STOCK_LOW",
  "STOCK_OUT",
  "RESERVATION_CREATED",
  "RESERVATION_EXPIRED",
  "STOCK_COMMITTED",
  "COMMIT_RELEASED",
  "LISTING_CHANGED",
  "FULFILLMENT_STATUS_CHANGED",
  "SCAN_TASK_CREATED",
  "SCAN_TASK_COMPLETED",
  "PRODUCT_REVIEW_REQUIRED"
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainActor {
  userId?: string;
  storefrontId?: string;
  correlationId?: string;
}

export interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
  externalDocumentRef?: string;
}

export interface OutboxEventInput {
  eventType: DomainEventType;
  storefrontId?: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /**
   * [C10] Per-consumer delivery targets, e.g. ['storefront:<uuid>', 'notifications'].
   */
  consumers: string[];
}

export interface DomainTransactionContext {
  readonly tx: DbExecutor;
  readonly actor: DomainActor;
  readonly correlationId: string;
  recordAudit(input: AuditLogInput): Promise<string>;
  emitOutboxEvent(input: OutboxEventInput): Promise<{ eventId: string; deliveryIds: string[] }>;
}

/**
 * Every state-changing domain operation runs in one database transaction
 * with its audit and transactional outbox rows (§3.4, [C10]).
 */
export async function withDomainTransaction<T>(
  db: AppDatabase,
  actor: DomainActor,
  fn: (ctx: DomainTransactionContext) => Promise<T>
): Promise<T> {
  const correlationId = actor.correlationId ?? createCorrelationId();

  return db.transaction(async (tx) => {
    const ctx: DomainTransactionContext = {
      tx,
      actor,
      correlationId,
      async recordAudit(input: AuditLogInput): Promise<string> {
        const auditId = createUuidV7();
        await tx.insert(auditLogs).values({
          id: auditId,
          actorUserId: actor.userId ?? null,
          actorStorefrontId: actor.storefrontId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          beforeJson: input.before ?? null,
          afterJson: input.after ?? null,
          reason: input.reason ?? null,
          externalDocumentRef: input.externalDocumentRef ?? null,
          correlationId
        });
        return auditId;
      },
      async emitOutboxEvent(input: OutboxEventInput) {
        const eventId = createUuidV7();
        await tx.insert(outboxEvents).values({
          id: eventId,
          eventType: input.eventType,
          storefrontId: input.storefrontId ?? null,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payloadJson: input.payload,
          correlationId
        });

        const uniqueConsumers = Array.from(new Set(input.consumers));
        const deliveryIds: string[] = [];

        for (const consumer of uniqueConsumers) {
          const deliveryId = createUuidV7();
          deliveryIds.push(deliveryId);
          await tx.insert(outboxDeliveries).values({
            id: deliveryId,
            outboxEventId: eventId,
            consumer,
            status: "PENDING",
            attempts: 0
          });
        }

        return { eventId, deliveryIds };
      }
    };

    return fn(ctx);
  });
}

export interface IdempotentExecutionOptions<TPayload> {
  scope: string;
  idempotencyKey: string;
  payload: TPayload;
  ttlSeconds?: number;
}

export interface IdempotentResult<TBody extends Record<string, unknown>> {
  status: number;
  body: TBody;
  replayed: boolean;
}

/**
 * Enforces idempotency on externally triggered writes (§3.4, §12.1, §16.5).
 */
export async function executeIdempotent<
  TPayload,
  TBody extends Record<string, unknown>
>(
  db: AppDatabase,
  options: IdempotentExecutionOptions<TPayload>,
  handler: () => Promise<{ status: number; body: TBody }>
): Promise<IdempotentResult<TBody>> {
  const requestHash = sha256Hex(JSON.stringify(options.payload ?? null));
  const now = new Date();

  const existingRows = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.scope, options.scope),
        eq(idempotencyKeys.idempotencyKey, options.idempotencyKey)
      )
    )
    .limit(1);

  const existing = existingRows[0];
  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key "${options.idempotencyKey}" was already used with a different payload.`
      );
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBodyJson as TBody,
      replayed: true
    };
  }

  const result = await handler();
  const ttlMs = (options.ttlSeconds ?? 86400) * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .insert(idempotencyKeys)
    .values({
      scope: options.scope,
      idempotencyKey: options.idempotencyKey,
      requestHash,
      responseStatus: result.status,
      responseBodyJson: result.body,
      expiresAt
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.scope, idempotencyKeys.idempotencyKey],
      set: {
        requestHash,
        responseStatus: result.status,
        responseBodyJson: result.body,
        expiresAt
      }
    });

  return {
    status: result.status,
    body: result.body,
    replayed: false
  };
}

export async function listRecentAuditLogs(db: AppDatabase, limit: number = 50) {
  return db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
