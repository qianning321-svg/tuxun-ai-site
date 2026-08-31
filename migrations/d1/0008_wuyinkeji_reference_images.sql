-- Prepared only; this migration is not applied by this change.
-- Nano Banana 2 Lite intentionally remains absent and disabled.
UPDATE models_config
SET
  supported_modes = '["text_to_image","image_to_image"]',
  max_reference_images = 5,
  updated_at = CURRENT_TIMESTAMP
WHERE model_key IN (
  'nano-banana',
  'nano-banana-pro',
  'nano-banana-2',
  'gpt-image-2-vip'
);
