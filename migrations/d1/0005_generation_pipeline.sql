PRAGMA foreign_keys = ON;

ALTER TABLE generation_tasks ADD COLUMN idempotency_key TEXT;
ALTER TABLE generation_tasks ADD COLUMN provider TEXT;
ALTER TABLE generation_tasks ADD COLUMN provider_model TEXT;
ALTER TABLE generation_tasks ADD COLUMN deduction_ledger_id TEXT;
ALTER TABLE generation_tasks ADD COLUMN refund_ledger_id TEXT;
ALTER TABLE generation_tasks ADD COLUMN generation_mode TEXT
  CHECK (generation_mode IN ('text_to_image', 'image_to_image'));
ALTER TABLE generation_tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (attempt_count >= 0);
ALTER TABLE generation_tasks ADD COLUMN last_error TEXT;
ALTER TABLE generation_tasks ADD COLUMN timeout_at TEXT;

ALTER TABLE generation_history ADD COLUMN result_image_r2_key TEXT;

ALTER TABLE models_config ADD COLUMN supported_modes TEXT NOT NULL
  DEFAULT '["text_to_image","image_to_image"]';
ALTER TABLE models_config ADD COLUMN max_reference_images INTEGER NOT NULL DEFAULT 5
  CHECK (max_reference_images >= 0 AND max_reference_images <= 5);

UPDATE models_config
SET provider = 'vibelearning',
    provider_model = 'gpt-image-2',
    updated_at = CURRENT_TIMESTAMP
WHERE model_key = 'gpt-image-2-pro';

CREATE TABLE IF NOT EXISTS generation_task_input_images (
  task_id TEXT NOT NULL,
  uploaded_image_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, uploaded_image_id),
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_image_id) REFERENCES uploaded_images(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_user_idempotency
  ON generation_tasks(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_tasks_provider_task
  ON generation_tasks(provider_task_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_history_task_unique
  ON generation_history(task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_generation_reason
  ON credit_ledger(ref_type, ref_id, reason)
  WHERE ref_type = 'generation_task'
    AND reason IN ('generation_deduction', 'generation_refund');

CREATE INDEX IF NOT EXISTS idx_generation_task_input_images_task_order
  ON generation_task_input_images(task_id, sort_order);
