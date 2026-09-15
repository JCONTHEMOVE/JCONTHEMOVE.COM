/** Add the existing checkout fields to older catalogs without changing rows. */
export const JEWELRY_RESERVATION_COLUMNS = `
  ALTER TABLE jewelry_items
    ADD COLUMN IF NOT EXISTS pending_credit_user_id VARCHAR REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS pending_credit_cents NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS pending_square_order_id TEXT;
`;
