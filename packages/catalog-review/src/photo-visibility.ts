import { sql } from "drizzle-orm";
import { catalogReviewPhotoLinks as links, catalogReviewPhotoWork as work } from "@khidi/db";

/** One-off operator-only cutoffs exclude earlier experiments from the reviewer, not from audit or storage. */
export const visiblePhotoWork = sql<boolean>`NOT EXISTS (
  SELECT 1 FROM catalog_review_photo_test_resets r
  WHERE r.product_id = ${work.productId}
    AND r.actor_id = ${work.actorId}
    AND ${work.createdAt} <= r.cutoff_at
)`;

/** Only photos appended to a gallery by the voided actor are hidden; imported photos stay untouched. */
export const visibleGalleryPhoto = sql<boolean>`NOT EXISTS (
  SELECT 1 FROM catalog_review_photo_work w
  JOIN catalog_review_photo_test_resets r
    ON r.product_id = w.product_id AND r.actor_id = w.actor_id
  WHERE w.product_id = ${links.productId}
    AND w.photo_id = ${links.photoId}
    AND w.kind IN ('UPLOAD', 'ACCEPT')
    AND w.created_at <= r.cutoff_at
)`;
