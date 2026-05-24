# P1.2 Egress Profile And Throttle Checklist

Student frontend traffic has already been moved to Cloudflare Pages. This phase focuses on Render-side service-initiated outbound traffic.

## Live profile

- Super-admin JSON endpoint: `/api/super-admin/egress-profile`
- Auth: `x-super-admin-auth`
- Purpose: expose recent outbound-heavy categories, counts, duration, bytes, object counts, and a rolling recent-event feed

Current instrumentation covers:

- `endpoint:health`
- `endpoint:public-ops-health`
- `primary-storage:json-read`
- `primary-storage:json-write`
- `primary-storage:list-folder`
- `ops-scan:global-hot-storage`
- `ops-scan:activity-storage`
- `archive-s3:full-bucket-scan`
- `archive-object:upload`
- `archive-object:download`
- `archive-object:delete`
- `archive-object:list-snapshots`
- `network:remote-buffer-download`
- `loop:transcode-scan`
- `loop:archive-scan`

## P1 actions

- `Done`: keep public health checks lightweight
  Student portal now uses `/api/ops/public-health`, and `/api/health` only loads full archive/hot storage details when explicitly requested.

- `Watch`: full R2 bucket scans
  `buildArchiveStorageSummary()` still performs full `ListObjectsV2` traversal when archive storage summary is requested.
  Action: keep this on explicit admin diagnostics only. If scan frequency stays high, increase `ARCHIVE_STORAGE_CACHE_TTL_MS` or move the summary to a scheduled snapshot.

- `Watch`: global hot storage rebuilds
  `buildGlobalHotStorageSummary()` still scans all submissions plus tracked Supabase storage folders.
  Action: keep this on admin-only routes. If still noisy, persist a scheduled snapshot instead of recomputing on demand.

- `Watch`: per-submission manifest reads
  Storage summaries still read many manifest JSON files individually from primary storage.
  Action: mirror frequently queried manifest fields into DB columns or a precomputed ops snapshot.

- `Watch`: activity storage diagnostics
  `buildStorageSummary(activityId)` still performs broad submission and storage listing work.
  Action: do not auto-refresh teacher/admin storage panels. Use manual refresh and caching.

- `Watch`: proxy downloads through Render
  `downloadRemoteBuffer()` and archive restore fallback still move bytes through Render.
  Action: prefer direct R2 public URLs, signed URLs, or client-side fetches when possible.

- `Watch`: idle background scans
  Archive and transcode loops now back off when idle, but they still scan candidate rows when they do wake up.
  Action: if telemetry still shows frequent zero-work scans, increase idle intervals again or introduce persisted work queues.

## Next optimization targets

1. Add a small super-admin panel for `/api/super-admin/egress-profile`.
2. Persist a scheduled hot-storage summary instead of rebuilding on request.
3. Persist a scheduled archive-storage snapshot instead of full-bucket scans on demand.
4. Reduce manifest JSON fan-out by denormalizing archive/transcode state into `submissions`.
5. Replace proxy media restore paths with direct object-store delivery where allowed.
