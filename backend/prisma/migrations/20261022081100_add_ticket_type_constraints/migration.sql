ALTER TABLE "ticket_type"
  ADD CONSTRAINT "ticket_type_price_kobo_non_negative"
  CHECK ("priceKobo" >= 0),
  ADD CONSTRAINT "ticket_type_capacity_positive"
  CHECK (capacity > 0),
  ADD CONSTRAINT "ticket_type_max_per_order_positive"
  CHECK ("maxPerOrder" IS NULL OR "maxPerOrder" > 0),
  ADD CONSTRAINT "ticket_type_sales_window_ordered"
  CHECK (
    "salesStartAt" IS NULL
    OR "salesEndAt" IS NULL
    OR "salesStartAt" < "salesEndAt"
  );
