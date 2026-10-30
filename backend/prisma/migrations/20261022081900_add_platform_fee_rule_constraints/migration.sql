ALTER TABLE "platform_fee_rule"
  ADD CONSTRAINT "platform_fee_rule_mode_value_matches"
  CHECK (
    (
      mode = 'PERCENTAGE'
      AND "percentageBasisPoints" IS NOT NULL
      AND "percentageBasisPoints" >= 0
      AND "fixedAmountKobo" IS NULL
    )
    OR (
      mode = 'FIXED'
      AND "fixedAmountKobo" IS NOT NULL
      AND "fixedAmountKobo" >= 0
      AND "percentageBasisPoints" IS NULL
    )
  ),
  ADD CONSTRAINT "platform_fee_rule_effective_window_ordered"
  CHECK ("activeUntil" IS NULL OR "activeFrom" < "activeUntil");

ALTER TABLE "platform_fee_rule"
  ADD CONSTRAINT "platform_fee_rule_no_effective_overlap"
  EXCLUDE USING gist (
    tsrange(
      "activeFrom",
      COALESCE("activeUntil", 'infinity'::timestamp),
      '[)'
    ) WITH &&
  );
