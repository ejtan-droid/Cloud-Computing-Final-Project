-- Optional: the app creates these tables itself on startup. Use this only if you
-- prefer to create them manually in the Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, username VARCHAR(30) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL, store_name VARCHAR(80) NOT NULL DEFAULT 'My Store',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY, owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, sku VARCHAR(40) NOT NULL, category VARCHAR(50) NOT NULL DEFAULT 'General',
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0), quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_owner_sku UNIQUE (owner_id, sku));
CREATE INDEX IF NOT EXISTS ix_products_owner_id ON products(owner_id);
CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY, owner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL, product_name VARCHAR(100) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0), unit_price NUMERIC(12,2) NOT NULL, total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_sales_owner_created ON sales(owner_id, created_at);
-- Supabase tip: enable Row Level Security so the public Supabase API cannot read these
-- tables. The FastAPI backend connects as the database owner and is unaffected.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
