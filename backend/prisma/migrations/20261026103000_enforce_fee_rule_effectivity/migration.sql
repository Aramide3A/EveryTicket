ALTER TABLE "platform_fee_rule"
  ADD CONSTRAINT "platform_fee_rule_effectivity_exclusion"
  EXCLUDE USING GIST (
    tsrange("activeFrom", COALESCE("activeUntil", 'infinity'::timestamp), '[)') WITH &&
  );
