ALTER TABLE event_media
  ADD COLUMN position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS event_media_eventId_status_idx;
CREATE INDEX event_media_eventId_status_position_idx ON event_media("eventId", status, position);
