BEGIN;

-- Replay payloads are short-lived but sensitive. Existing database blobs are
-- deliberately discarded during this one-way migration instead of copied to a
-- possibly unconfigured object store. New rows have an opaque private handle.
DELETE FROM replay_chunks;
DELETE FROM replay_sessions;

ALTER TABLE replay_chunks
  DROP CONSTRAINT replay_chunks_payload_check,
  DROP COLUMN payload,
  ADD COLUMN artifact_ref text NOT NULL,
  ADD COLUMN artifact_byte_count integer NOT NULL CHECK (artifact_byte_count BETWEEN 1 AND 262144),
  ADD CONSTRAINT replay_chunks_artifact_ref_check CHECK (artifact_ref ~ '^replay/[0-9a-f-]{36}\.json$');

COMMIT;
