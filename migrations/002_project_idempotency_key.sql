-- Optional client-supplied key that makes POST /projects safe to retry.
-- The column is nullable, so existing rows and clients that send no key are unaffected.
ALTER TABLE projects
  ADD COLUMN idempotency_key text CHECK (length(idempotency_key) BETWEEN 1 AND 200);

-- One project per (tenant, key); rows without a key are not constrained.
CREATE UNIQUE INDEX projects_tenant_idempotency_key_idx
  ON projects (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
