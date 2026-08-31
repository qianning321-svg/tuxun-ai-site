import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

const migrationPath = new URL("../migrations/d1/0007_wuyinkeji_image_models.sql", import.meta.url);
const migrationSql = await Bun.file(migrationPath).text();

type ModelRow = {
  id: string;
  model_key: string;
  display_name: string;
  provider: string;
  provider_model: string;
  task_type: string;
  cost_credits: number;
  is_enabled: number;
  sort_order: number;
  supported_modes: string;
  max_reference_images: number;
  created_at: string;
};

function createDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE models_config (
      id TEXT PRIMARY KEY,
      model_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      cost_credits INTEGER NOT NULL DEFAULT 1 CHECK (cost_credits >= 0),
      is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      supported_modes TEXT NOT NULL DEFAULT '["text_to_image","image_to_image"]',
      max_reference_images INTEGER NOT NULL DEFAULT 5 CHECK (max_reference_images >= 0 AND max_reference_images <= 5),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

describe("Wuyinkeji image model migration", () => {
  test("upserts only the four configured models without changing Pro or Lite", () => {
    const database = createDatabase();
    database.query(`
      INSERT INTO models_config (
        id, model_key, display_name, provider, provider_model, task_type,
        cost_credits, is_enabled, sort_order, description, supported_modes,
        max_reference_images, created_at, updated_at
      ) VALUES
        ('pro-id', 'gpt-image-2-pro', 'GPT-IMAGE-2.0 Pro', 'vibelearning', 'gpt-image-2', 'image', 28, 1, 0, 'protected', '["text_to_image","image_to_image"]', 5, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
        ('old-nano-id', 'nano-banana', 'Old Nano', 'legacy', 'old-model', 'image', 1, 0, 99, 'old', '["image_to_image"]', 5, '2026-01-02 00:00:00', '2026-01-02 00:00:00')
    `).run();

    database.exec(migrationSql);
    database.exec(migrationSql);

    const rows = database.query(`
      SELECT id, model_key, display_name, provider, provider_model, task_type,
             cost_credits, is_enabled, sort_order, supported_modes,
             max_reference_images, created_at
      FROM models_config WHERE model_key != 'gpt-image-2-pro' ORDER BY sort_order
    `).all() as ModelRow[];
    expect(rows).toEqual([
      expect.objectContaining({ id: 'old-nano-id', model_key: 'nano-banana', display_name: 'Nano Banana', provider: 'wuyinkeji', provider_model: 'image_nanoBanana', task_type: 'image', cost_credits: 15, is_enabled: 1, sort_order: 1, supported_modes: '["text_to_image"]', max_reference_images: 0, created_at: '2026-01-02 00:00:00' }),
      expect.objectContaining({ model_key: 'nano-banana-pro', display_name: 'Nano Banana Pro', provider: 'wuyinkeji', provider_model: 'image_nanoBanana_pro', task_type: 'image', cost_credits: 45, is_enabled: 1, sort_order: 2, supported_modes: '["text_to_image"]', max_reference_images: 0 }),
      expect.objectContaining({ model_key: 'nano-banana-2', display_name: 'Nano Banana 2', provider: 'wuyinkeji', provider_model: 'image_nanoBanana2', task_type: 'image', cost_credits: 15, is_enabled: 1, sort_order: 3, supported_modes: '["text_to_image"]', max_reference_images: 0 }),
      expect.objectContaining({ model_key: 'gpt-image-2-vip', display_name: 'GPT Image 2', provider: 'wuyinkeji', provider_model: 'image_gpt', task_type: 'image', cost_credits: 15, is_enabled: 1, sort_order: 4, supported_modes: '["text_to_image"]', max_reference_images: 0 }),
    ]);
    expect(database.query("SELECT * FROM models_config WHERE model_key = 'gpt-image-2-pro'").get()).toMatchObject({ provider: 'vibelearning', provider_model: 'gpt-image-2', cost_credits: 28, is_enabled: 1, sort_order: 0 });
    expect(database.query("SELECT COUNT(*) AS count FROM models_config WHERE model_key = 'nano-banana-2-lite'").get()).toEqual({ count: 0 });
  });

  test("contains only the verified model keys and an explicit conflict update", () => {
    expect(migrationSql).toContain("ON CONFLICT(model_key) DO UPDATE");
    expect(migrationSql).not.toContain("nano-banana-2-lite");
    expect(migrationSql).not.toContain("gpt-image-2-pro");
    expect(migrationSql).not.toMatch(/UPDATE\s+models_config\s+SET/i);
  });
});
