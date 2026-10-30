ALTER TABLE "order"
  ADD CONSTRAINT "order_monetary_values_non_negative"
  CHECK (
    "ticketSubtotalKobo" >= 0
    AND "platformFeeKobo" >= 0
    AND "totalKobo" >= 0
  ),
  ADD CONSTRAINT "order_total_matches_breakdown"
  CHECK ("totalKobo" = "ticketSubtotalKobo" + "platformFeeKobo"),
  ADD CONSTRAINT "order_fee_snapshot_matches_mode"
  CHECK (
    (
      "platformFeeMode" = 'PERCENTAGE'
      AND "platformFeePercentageBasisPoints" IS NOT NULL
      AND "platformFeePercentageBasisPoints" >= 0
      AND "platformFeeFixedAmountKobo" IS NULL
    )
    OR (
      "platformFeeMode" = 'FIXED'
      AND "platformFeeFixedAmountKobo" IS NOT NULL
      AND "platformFeeFixedAmountKobo" >= 0
      AND "platformFeePercentageBasisPoints" IS NULL
    )
  );

ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_price_non_negative"
  CHECK ("unitPriceKobo" >= 0),
  ADD CONSTRAINT "order_line_quantity_positive"
  CHECK (quantity > 0);
