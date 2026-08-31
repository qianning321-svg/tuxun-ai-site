ALTER TABLE recharge_packages
ADD COLUMN button_text TEXT NOT NULL DEFAULT '前往购买';

ALTER TABLE recharge_packages
ADD COLUMN is_popular INTEGER NOT NULL DEFAULT 0 CHECK (is_popular IN (0, 1));

ALTER TABLE recharge_packages
ADD COLUMN is_highlighted INTEGER NOT NULL DEFAULT 0 CHECK (is_highlighted IN (0, 1));

ALTER TABLE recharge_packages
ADD COLUMN benefits_text TEXT;
