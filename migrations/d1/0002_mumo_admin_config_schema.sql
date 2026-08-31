PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link_url TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recharge_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  price_text TEXT NOT NULL,
  badge TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  buy_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'disabled')),
  used_by_user_id TEXT,
  used_by_label TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_admin_id TEXT,
  note TEXT,
  FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS style_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  prompt TEXT,
  preview_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_settings (key, value_json)
VALUES ('site_brand', '{"brandName":"TuXun AI","logoPath":"/mumo-logo.png","subtitle":"TUXUN AI VISUAL STUDIO"}');

INSERT OR IGNORE INTO system_settings (key, value_json)
VALUES ('contact_info', '{"description":"如需帮助，请联系在线客服。","wechat":"","email":"","serviceHours":"工作日 09:00–18:00","enabled":true}');

INSERT OR IGNORE INTO system_settings (key, value_json)
VALUES ('recharge_purchase_config', '{"enabled":true,"emptyMessage":"购买链接暂未配置，请联系客服"}');

INSERT OR IGNORE INTO system_settings (key, value_json)
VALUES ('redeem_config', '{"enabled":true,"formatHint":"请输入 MUMO 兑换码"}');

INSERT OR IGNORE INTO system_settings (key, value_json)
VALUES ('admin_access_password', '{"password":"","note":"上线前应改为安全哈希验证"}');

CREATE INDEX IF NOT EXISTS idx_ads_enabled_sort ON ads(is_enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_announcements_enabled_sort ON announcements(is_enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_recharge_packages_enabled_sort ON recharge_packages(is_enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_code ON redeem_codes(code);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_style_templates_enabled_sort ON style_templates(is_enabled, sort_order);
