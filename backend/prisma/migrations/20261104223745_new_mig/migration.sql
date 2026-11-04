-- DropIndex
DROP INDEX "event_media_eventId_status_idx";

-- RenameIndex
ALTER INDEX "event_media_eventid_status_position_idx" RENAME TO "event_media_eventId_status_position_idx";
