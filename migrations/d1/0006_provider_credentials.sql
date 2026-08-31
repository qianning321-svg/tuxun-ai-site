CREATE TABLE IF NOT EXISTS provider_credentials (
  provider TEXT PRIMARY KEY,
  base_url TEXT,
  api_key_ciphertext TEXT,
  api_key_iv TEXT,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (api_key_ciphertext IS NULL AND api_key_iv IS NULL)
    OR (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL)
  )
);
