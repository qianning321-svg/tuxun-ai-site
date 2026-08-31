PRAGMA foreign_keys = ON;

-- These fixed UUIDv4-shaped IDs follow the models_config identifier format used
-- by the server. Existing rows retain their original id and created_at values.
INSERT INTO models_config (
  id, model_key, display_name, provider, provider_model, task_type,
  cost_credits, is_enabled, sort_order, description,
  supported_modes, max_reference_images, created_at, updated_at
)
VALUES
  ('06d2c26e-1b33-4b64-8e5e-baa9695a4c11', 'nano-banana',     'Nano Banana',     'wuyinkeji', 'image_nanoBanana',     'image', 15, 1, 1, 'Text-to-image, 1K only.',         '["text_to_image"]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('3a071e4e-4df1-4bf8-9226-7f6c5aa1b892', 'nano-banana-pro', 'Nano Banana Pro', 'wuyinkeji', 'image_nanoBanana_pro', 'image', 45, 1, 2, 'Text-to-image, 1K, 2K, and 4K.', '["text_to_image"]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('d934c1c9-908f-4e42-8f75-3f3520a5df36', 'nano-banana-2',   'Nano Banana 2',   'wuyinkeji', 'image_nanoBanana2',    'image', 15, 1, 3, 'Text-to-image, 1K, 2K, and 4K.', '["text_to_image"]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('b0a8a37c-59d4-4c37-87bd-8fd2a33f7775', 'gpt-image-2-vip', 'GPT Image 2',     'wuyinkeji', 'image_gpt',            'image', 15, 1, 4, 'Text-to-image, 1K only.',         '["text_to_image"]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(model_key) DO UPDATE SET
  display_name = excluded.display_name,
  provider = excluded.provider,
  provider_model = excluded.provider_model,
  task_type = excluded.task_type,
  cost_credits = excluded.cost_credits,
  is_enabled = excluded.is_enabled,
  sort_order = excluded.sort_order,
  description = excluded.description,
  supported_modes = excluded.supported_modes,
  max_reference_images = excluded.max_reference_images,
  updated_at = CURRENT_TIMESTAMP;
