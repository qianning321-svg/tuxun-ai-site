PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS uploaded_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'consumed', 'expired', 'deleted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_uploaded_images_user_id
  ON uploaded_images(user_id);

CREATE INDEX IF NOT EXISTS idx_uploaded_images_created_at
  ON uploaded_images(created_at);

CREATE INDEX IF NOT EXISTS idx_uploaded_images_expires_at
  ON uploaded_images(expires_at);

