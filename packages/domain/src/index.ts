import { and, desc, eq, lte, sql } from "drizzle-orm";
import {
  type AppDatabase,
  type DbExecutor,
  auditLogs,
  outboxEvents,
  outboxDeliveries,
  idempotencyKeys
} from "@khidi/db";
import {
  AppError,
  createCorrelationId,
  createUuidV7,
  sha256Hex
} from "@khidi/shared";

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
  "PHOTO_REQUEST_PROGRESS_UPDATED",
  "PRODUCT_INTAKE_RECORDED",
  "INTAKE_REVIEW_RESOLVED",
  "OFFLINE_SCAN_DISCARDED",
  "MEDIA_JOB_REQUESTED",
  "IMAGE_UPLOADED",
  "IMAGE_QUALITY_DISAGREEMENT",
  "FIRST_ADMIN_BOOTSTRAPPED",
  "TOTP_ENROLLMENT_STARTED",
  "TOTP_ENROLLMENT_COMPLETED",
  "TOTP_ENROLLMENT_RESTARTED",
  "USER_RECOVERY_PERFORMED",
  "PASSKEY_CHALLENGE_ISSUED",
  "PASSKEY_REGISTERED",
  "PASSKEY_SIGN_IN",
  "PASSKEY_AUTH_FAILED",
  "PASSKEY_REVOKED",
  "PASSKEY_RENAMED",
  "STRONG_AUTH_COMPLETED",
  "STRONG_AUTH_FAILED",
  "PASSWORD_CHANGED",
  "TOTP_SELF_ENROLLMENT_STARTED",
  "IMAGE_PROCESSED",
  "IMAGE_TIER2_CHECKED",
  "IMAGE_UPDATED",
  "IMAGE_REPROCESSED",
  "MEDIA_JOB_UPDATED",
  "IMAGE_PUBLICATION_CHANGED",
  "INTAKE_IMAGES_LINKED",
  "PHOTO_ATTENTION_REPORTED",
  "OFFLINE_PHOTO_DISCARDED",
  "LABEL_STATUS_CHANGED",
  "PRODUCT_REVIEW_REQUIRED",
  "EVIDENCE_UPDATED",
  "AI_JOB_REQUESTED",
  "AI_JOB_UPDATED"
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

export function createDomainTransactionContext(
  tx: DbExecutor,
  actor: DomainActor
): DomainTransactionContext {
  const correlationId = actor.correlationId ?? createCorrelationId();

  return {
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
}

/**
 * Every state-changing domain operation runs in one database transaction
 * with its audit and transactional outbox rows (§3.4, [C10]).
 *
 * Accepts either top-level `AppDatabase` OR an already-active `DbExecutor` (`tx`),
 * in which case Drizzle uses a nested PostgreSQL `SAVEPOINT` inside the outer transaction
 * (e.g., when called inside `executeIdempotent`).
 */
export async function withDomainTransaction<T>(
  dbOrTx: AppDatabase | DbExecutor,
  actor: DomainActor,
  fn: (ctx: DomainTransactionContext) => Promise<T>
): Promise<T> {
  return dbOrTx.transaction(async (tx) => {
    const ctx = createDomainTransactionContext(tx, actor);
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
 * Enforces atomic, transactional idempotency on externally triggered writes (§3.4, §12.1, §16.5).
 *
 * 1. Claims `(scope, idempotency_key)` via `INSERT ... ON CONFLICT DO NOTHING` with `status = 'IN_PROGRESS'`
 *    inside the same database transaction in which `handler(tx)` executes.
 * 2. Concurrent requests with the same `(scope, idempotency_key)` block on PostgreSQL's unique index lock
 *    until the claiming transaction commits or rolls back.
 * 3. On completion, updates the row to `status = 'COMPLETED'` with `response_status` and `response_body_json`
 *    before committing the transaction.
 */
export async function executeIdempotent<
  TPayload,
  TBody extends Record<string, unknown>
>(
  db: AppDatabase | DbExecutor,
  options: IdempotentExecutionOptions<TPayload>,
  handler: (tx: DbExecutor) => Promise<{ status: number; body: TBody }>
): Promise<IdempotentResult<TBody>> {
  const requestHash = sha256Hex(JSON.stringify(options.payload ?? null));
  const ttlMs = (options.ttlSeconds ?? 86400) * 1000;

  return db.transaction(async (tx) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    // 1. Purge expired key for the same (scope, idempotency_key) if present
    await tx
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.scope, options.scope),
          eq(idempotencyKeys.idempotencyKey, options.idempotencyKey),
          lte(idempotencyKeys.expiresAt, now)
        )
      );

    // 2. Atomically claim the key with status = 'IN_PROGRESS'.
    // If another concurrent transaction has already inserted this key and not yet committed,
    // PostgreSQL blocks here until that transaction commits or rolls back.
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        scope: options.scope,
        idempotencyKey: options.idempotencyKey,
        requestHash,
        status: "IN_PROGRESS",
        responseStatus: null,
        responseBodyJson: null,
        expiresAt
      })
      .onConflictDoNothing({
        target: [idempotencyKeys.scope, idempotencyKeys.idempotencyKey]
      })
      .returning({ scope: idempotencyKeys.scope });

    if (claimed.length === 0) {
      // Key was already claimed and committed by a prior request
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.scope, options.scope),
            eq(idempotencyKeys.idempotencyKey, options.idempotencyKey)
          )
        )
        .limit(1);

      if (!existing) {
        throw new AppError("CONFLICT", "Idempotency key state disappeared unexpectedly.");
      }

      if (existing.requestHash !== requestHash) {
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          `Idempotency key "${options.idempotencyKey}" was already used with a different payload.`
        );
      }

      if (
        existing.status !== "COMPLETED" ||
        existing.responseStatus === null ||
        existing.responseBodyJson === null
      ) {
        throw new AppError(
          "CONFLICT",
          `Idempotency key "${options.idempotencyKey}" is currently in progress.`
        );
      }

      return {
        status: existing.responseStatus,
        body: existing.responseBodyJson as TBody,
        replayed: true
      };
    }

    // 3. Execute the handler inside the same transaction `tx`
    const result = await handler(tx);

    // 4. Mark the claimed key as COMPLETED with its response payload
    await tx
      .update(idempotencyKeys)
      .set({
        status: "COMPLETED",
        responseStatus: result.status,
        responseBodyJson: result.body,
        expiresAt: sql`${expiresAt}`
      })
      .where(
        and(
          eq(idempotencyKeys.scope, options.scope),
          eq(idempotencyKeys.idempotencyKey, options.idempotencyKey)
        )
      );

    return {
      status: result.status,
      body: result.body,
      replayed: false
    };
  });
}

export async function listRecentAuditLogs(db: AppDatabase | DbExecutor, limit: number = 50) {
  return db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
