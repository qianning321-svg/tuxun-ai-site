-- Prepared only; apply separately after reviewing the external archiver deployment.
ALTER TABLE generation_tasks ADD COLUMN archive_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (archive_status IN ('not_required', 'pending', 'processing', 'archived', 'failed'));
ALTER TABLE generation_tasks ADD COLUMN archive_job_id TEXT;
ALTER TABLE generation_tasks ADD COLUMN archive_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (archive_attempt_count >= 0);
ALTER TABLE generation_tasks ADD COLUMN archive_last_error_code TEXT;
ALTER TABLE generation_tasks ADD COLUMN archived_at TEXT;
ALTER TABLE generation_tasks ADD COLUMN archive_claimed_at TEXT;

ALTER TABLE generation_history ADD COLUMN archive_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (archive_status IN ('not_required', 'pending', 'processing', 'archived', 'failed'));
ALTER TABLE generation_history ADD COLUMN archive_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (archive_attempt_count >= 0);
ALTER TABLE generation_history ADD COLUMN archive_last_error_code TEXT;
ALTER TABLE generation_history ADD COLUMN archived_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_tasks_archive_job
  ON generation_tasks(archive_job_id)
  WHERE archive_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_history_user_visible_created
  ON generation_history(user_id, deleted_at, created_at DESC);
