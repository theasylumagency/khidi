-- Scope metadata is separate: never rewrite immutable historical audit content.
CREATE TABLE audit_legal_entity_scopes (
 audit_id uuid NOT NULL REFERENCES audit_logs(id) ON DELETE RESTRICT,
 legal_entity_id uuid NOT NULL REFERENCES legal_entities(id) ON DELETE RESTRICT,
 PRIMARY KEY(audit_id,legal_entity_id)
);
CREATE INDEX audit_legal_entity_lookup ON audit_legal_entity_scopes(legal_entity_id,audit_id DESC);
CREATE INDEX audit_history_actor ON audit_logs(actor_type,actor_id,id DESC);
CREATE INDEX audit_history_action ON audit_logs(action,id DESC);
CREATE INDEX audit_history_entity_type ON audit_logs(entity_type,id DESC);
CREATE INDEX audit_history_date ON audit_logs(created_at,id DESC);

CREATE FUNCTION audit_scope_ids(a audit_logs) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
 WITH fields AS (
  SELECT f.key, f.value #>> '{}' AS value
  FROM jsonb_path_query(jsonb_build_array(a.before_json,a.after_json),'$.**') v
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(v)='object' THEN v ELSE '{}'::jsonb END) f
  WHERE jsonb_typeof(f.value)='string'
 ), refs AS (
  SELECT a.entity_type AS kind,a.entity_id AS id
  UNION SELECT key,value FROM fields
 ), stores AS (
  SELECT s.id,s.seller_entity_id FROM storefronts s JOIN refs r ON s.id::text=r.id
   WHERE r.kind IN ('storefront','storefrontId','storefront_id')
  UNION SELECT s.id,s.seller_entity_id FROM reservations h JOIN storefronts s ON s.id=h.storefront_id
    JOIN refs r ON r.id=h.id::text WHERE r.kind IN ('reservation','reservationId','reservation_id')
  UNION SELECT s.id,s.seller_entity_id FROM fulfillment_requests h JOIN storefronts s ON s.id=h.storefront_id
    JOIN refs r ON r.id=h.id::text WHERE r.kind IN ('fulfillment_request','fulfillmentRequestId')
  UNION SELECT id,seller_entity_id FROM storefronts WHERE id=a.actor_storefront_id
 ), pools AS (
  SELECT p.owner_entity_id FROM stock_pools p JOIN refs r ON r.id=p.id::text
    WHERE r.kind IN ('stock_pool','poolId','pool_id')
  UNION SELECT p.owner_entity_id FROM allocations x JOIN stock_pools p ON p.id=x.pool_id JOIN refs r ON r.id=x.id::text
    WHERE r.kind IN ('allocation','allocationId','allocation_id')
  UNION SELECT p.owner_entity_id FROM reservation_lines l JOIN allocations x ON x.id=l.allocation_id
    JOIN stock_pools p ON p.id=x.pool_id JOIN refs r ON r.id=l.reservation_id::text
    WHERE r.kind IN ('reservation','reservationId','reservation_id')
 )
 SELECT e.id FROM legal_entities e JOIN fields f ON e.id::text=f.value
  WHERE f.key IN ('legalEntityId','ownerEntityId','sellerEntityId','fromEntityId','toEntityId',
   'legal_entity_id','owner_entity_id','seller_entity_id')
 UNION SELECT seller_entity_id FROM stores
 UNION SELECT owner_entity_id FROM pools
 UNION SELECT legal_entity_id FROM daily_reports d WHERE a.entity_type='daily_report' AND d.id::text=a.entity_id
 UNION SELECT legal_entity_id FROM notifications n WHERE a.entity_type='notification' AND n.id::text=a.entity_id AND legal_entity_id IS NOT NULL
 UNION SELECT id FROM legal_entities WHERE a.entity_type='legal_entity' AND id::text=a.entity_id
$$;
INSERT INTO audit_legal_entity_scopes SELECT a.id,s.id FROM audit_logs a CROSS JOIN LATERAL audit_scope_ids(a) s(id) ON CONFLICT DO NOTHING;
CREATE FUNCTION index_audit_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.audit_legal_entity_scopes SELECT NEW.id,s.id FROM public.audit_scope_ids(NEW) s(id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER index_audit_scope AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION index_audit_scope();
SELECT enforce_append_only_table('audit_legal_entity_scopes');
GRANT SELECT ON audit_legal_entity_scopes TO hub_app;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON audit_legal_entity_scopes FROM hub_app;
