import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AppDatabase,
  type DbExecutor,
  type ReservationPolicyConfig,
  legalEntities,
  users,
  storefronts,
  entityRelationships
} from "@khidi/db";
import { type DomainActor, withDomainTransaction } from "@khidi/domain";
import {
  AppError,
  createUuidV7,
  relationshipModeSchema,
  type RelationshipMode
} from "@khidi/shared";

export const createLegalEntitySchema = z.object({
  key: z.string().trim().min(2).max(32).regex(/^[A-Z0-9_]+$/),
  legalName: z.string().trim().min(2).max(200),
  taxId: z.string().trim().min(5).max(32),
  pricesIncludeVat: z.boolean() // [C11]
});

export type CreateLegalEntityInput = z.infer<typeof createLegalEntitySchema>;

export const createStorefrontSchema = z.object({
  key: z.string().trim().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(120),
  domain: z.string().trim().min(3).max(255),
  sellerEntityId: z.string().uuid(),
  mediaBaseUrl: z.string().url(),
  webhookUrl: z.string().url().optional(),
  reservationPolicy: z
    .object({
      CARD: z.number().int().positive(),
      BANK_INSTALLMENT: z.number().int().positive(),
      PAY_ON_PICKUP: z.number().int().positive(),
      CASH_ON_DELIVERY: z.number().int().positive()
    })
    .optional()
});

export type CreateStorefrontInput = z.infer<typeof createStorefrontSchema>;

export const setEntityRelationshipSchema = z.object({
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  mode: relationshipModeSchema,
  effectiveFrom: z.date().optional(),
  notes: z.string().max(500).optional()
});

export type SetEntityRelationshipInput = z.infer<typeof setEntityRelationshipSchema>;

export async function createLegalEntity(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  rawInput: CreateLegalEntityInput
) {
  const input = createLegalEntitySchema.parse(rawInput);

  return withDomainTransaction(db, actor, async (ctx) => {
    const id = createUuidV7();
    const [created] = await ctx.tx
      .insert(legalEntities)
      .values({
        id,
        key: input.key,
        legalName: input.legalName,
        taxId: input.taxId,
        pricesIncludeVat: input.pricesIncludeVat,
        active: true
      })
      .returning();

    if (!created) {
      throw new AppError("INTERNAL" as never, "Failed to insert legal entity");
    }

    await ctx.recordAudit({
      action: "LEGAL_ENTITY_CREATED",
      entityType: "legal_entity",
      entityId: created.id,
      after: {
        key: created.key,
        legalName: created.legalName,
        taxId: created.taxId,
        pricesIncludeVat: created.pricesIncludeVat
      }
    });

    return created;
  });
}

export async function listLegalEntities(db: AppDatabase | DbExecutor) {
  return db.select().from(legalEntities).orderBy(legalEntities.key);
}

export async function getLegalEntityById(db: AppDatabase | DbExecutor, id: string) {
  const [entity] = await db.select().from(legalEntities).where(eq(legalEntities.id, id)).limit(1);
  if (!entity) {
    throw new AppError("NOT_FOUND", `Legal entity ${id} not found`);
  }
  return entity;
}

export async function createStorefront(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  rawInput: CreateStorefrontInput
) {
  const input = createStorefrontSchema.parse(rawInput);

  return withDomainTransaction(db, actor, async (ctx) => {
    const [admin] = actor.userId ? await ctx.tx.select().from(users).where(and(eq(users.id, actor.userId), eq(users.active, true), eq(users.role, "ADMIN"))) : [];
    if (!admin) throw new AppError("FORBIDDEN", "Storefront creation requires an admin.");
    const [seller] = await ctx.tx
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.id, input.sellerEntityId))
      .limit(1);

    if (!seller) {
      throw new AppError("NOT_FOUND", `Seller legal entity ${input.sellerEntityId} not found`);
    }

    const id = createUuidV7();
    const defaultPolicy: ReservationPolicyConfig = input.reservationPolicy ?? {
      CARD: 1800,
      BANK_INSTALLMENT: 259200,
      PAY_ON_PICKUP: 259200,
      CASH_ON_DELIVERY: 259200
    };

    const [created] = await ctx.tx
      .insert(storefronts)
      .values({
        id,
        key: input.key,
        name: input.name,
        domain: input.domain,
        sellerEntityId: input.sellerEntityId,
        mediaBaseUrl: input.mediaBaseUrl,
        webhookUrl: input.webhookUrl ?? null,
        reservationPolicyJson: defaultPolicy,
        active: true
      })
      .returning();

    if (!created) {
      throw new AppError("VALIDATION_ERROR", "Failed to create storefront");
    }

    await ctx.recordAudit({
      action: "STOREFRONT_CREATED",
      entityType: "storefront",
      entityId: created.id,
      after: {
        key: created.key,
        name: created.name,
        domain: created.domain,
        sellerEntityId: created.sellerEntityId,
        mediaBaseUrl: created.mediaBaseUrl
      }
    });

    await ctx.emitOutboxEvent({ eventType: "STOREFRONT_CREATED", storefrontId: created.id, aggregateType: "storefront", aggregateId: created.id,
      payload: { storefrontId: created.id }, consumers: [] });
    return created;
  });
}

export async function listStorefronts(db: AppDatabase | DbExecutor) {
  return db
    .select({
      id: storefronts.id,
      key: storefronts.key,
      name: storefronts.name,
      domain: storefronts.domain,
      sellerEntityId: storefronts.sellerEntityId,
      sellerEntityKey: legalEntities.key,
      sellerEntityName: legalEntities.legalName,
      sellerPricesIncludeVat: legalEntities.pricesIncludeVat,
      mediaBaseUrl: storefronts.mediaBaseUrl,
      webhookUrl: storefronts.webhookUrl,
      reservationPolicyJson: storefronts.reservationPolicyJson,
      active: storefronts.active,
      createdAt: storefronts.createdAt
    })
    .from(storefronts)
    .innerJoin(legalEntities, eq(storefronts.sellerEntityId, legalEntities.id))
    .orderBy(storefronts.key);
}

/**
 * [C17] Sets or transitions the commercial relationship mode between two legal entities.
 * When transitioning CONSIGNMENT -> PURCHASE, optional guard checks that no cross-entity
 * allocations have open reservations or commitments.
 */
export async function setEntityRelationship(
  db: AppDatabase | DbExecutor,
  actor: DomainActor,
  rawInput: SetEntityRelationshipInput,
  options?: {
    hasOpenCrossEntityCommitmentsOrReservations?: () => Promise<boolean>;
  }
) {
  const input = setEntityRelationshipSchema.parse(rawInput);
  if (input.fromEntityId === input.toEntityId) {
    throw new AppError("VALIDATION_ERROR", "fromEntityId and toEntityId must be different entities");
  }

  return withDomainTransaction(db, actor, async (ctx) => {
    const [current] = await ctx.tx
      .select()
      .from(entityRelationships)
      .where(
        and(
          eq(entityRelationships.fromEntityId, input.fromEntityId),
          eq(entityRelationships.toEntityId, input.toEntityId)
        )
      )
      .orderBy(desc(entityRelationships.effectiveFrom))
      .limit(1);

    if (current?.mode === "CONSIGNMENT" && input.mode === "PURCHASE") {
      if (options?.hasOpenCrossEntityCommitmentsOrReservations) {
        const hasOpen = await options.hasOpenCrossEntityCommitmentsOrReservations();
        if (hasOpen) {
          throw new AppError(
            "PRECONDITION_FAILED",
            "Cannot switch CONSIGNMENT -> PURCHASE while cross-entity allocations have open reservations or commitments [C17]."
          );
        }
      }
    }

    const id = createUuidV7();
    const [created] = await ctx.tx
      .insert(entityRelationships)
      .values({
        id,
        fromEntityId: input.fromEntityId,
        toEntityId: input.toEntityId,
        mode: input.mode,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        notes: input.notes ?? null,
        createdBy: actor.userId ?? null
      })
      .returning();

    if (!created) {
      throw new AppError("VALIDATION_ERROR", "Failed to record entity relationship");
    }

    await ctx.recordAudit({
      action: "ENTITY_RELATIONSHIP_CHANGED",
      entityType: "entity_relationship",
      entityId: created.id,
      before: current ? { mode: current.mode, effectiveFrom: current.effectiveFrom } : null,
      after: {
        fromEntityId: created.fromEntityId,
        toEntityId: created.toEntityId,
        mode: created.mode,
        effectiveFrom: created.effectiveFrom
      },
      reason: input.notes
    });

    return created;
  });
}

export async function getActiveEntityRelationship(
  db: AppDatabase | DbExecutor,
  fromEntityId: string,
  toEntityId: string
): Promise<{ id: string; mode: RelationshipMode; effectiveFrom: Date; notes: string | null } | null> {
  const [rel] = await db
    .select()
    .from(entityRelationships)
    .where(
      and(
        eq(entityRelationships.fromEntityId, fromEntityId),
        eq(entityRelationships.toEntityId, toEntityId)
      )
    )
    .orderBy(desc(entityRelationships.effectiveFrom))
    .limit(1);

  if (!rel) {
    return null;
  }

  return {
    id: rel.id,
    mode: rel.mode as RelationshipMode,
    effectiveFrom: rel.effectiveFrom,
    notes: rel.notes
  };
}

export async function listEntityRelationships(db: AppDatabase | DbExecutor) {
  return db.select().from(entityRelationships).orderBy(desc(entityRelationships.effectiveFrom));
}
