ALTER TABLE "inventory_hold"
  ADD CONSTRAINT "inventory_hold_quantity_positive"
  CHECK (quantity > 0);
