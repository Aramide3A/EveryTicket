CREATE TABLE "ticket_category_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_category_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_category_template_name_key" ON "ticket_category_template"("name");
CREATE UNIQUE INDEX "ticket_category_template_slug_key" ON "ticket_category_template"("slug");

INSERT INTO "event_category" ("id", "name", "slug", "createdAt", "updatedAt") VALUES
  ('event-category-arts-culture', 'Arts & Culture', 'arts-culture', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-business-networking', 'Business & Networking', 'business-networking', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-community-causes', 'Community & Causes', 'community-causes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-education-workshops', 'Education & Workshops', 'education-workshops', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-family-kids', 'Family & Kids', 'family-kids', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-food-drink', 'Food & Drink', 'food-drink', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-music', 'Music', 'music', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-nightlife-entertainment', 'Nightlife & Entertainment', 'nightlife-entertainment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-sports-fitness', 'Sports & Fitness', 'sports-fitness', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('event-category-technology', 'Technology', 'technology', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "ticket_category_template" ("id", "name", "slug", "description", "createdAt", "updatedAt") VALUES
  ('ticket-template-general-admission', 'General Admission', 'general-admission', 'Standard entry to the event.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ticket-template-vip', 'VIP', 'vip', 'Premium entry with VIP access.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ticket-template-early-bird', 'Early Bird', 'early-bird', 'Discounted entry for early purchasers.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ticket-template-student', 'Student', 'student', 'Discounted entry for eligible students.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ticket-template-group', 'Group', 'group', 'Admission for a group of attendees.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ticket-template-complimentary', 'Complimentary', 'complimentary', 'No-charge entry issued by the organizer.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
