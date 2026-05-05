# Media Pipeline Setup

This project now supports:

- async video transcoding after upload
- thumbnail/poster generation
- hot storage in Supabase Storage
- optional cold archive to Google Drive or S3-compatible object storage

## Always-on flags

Set these in Render `Environment`:

```env
ASYNC_VIDEO_TRANSCODE=true
ARCHIVE_AFTER_DAYS=30
ARCHIVE_PROVIDER=none
ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false
```

Meaning:

- `ASYNC_VIDEO_TRANSCODE=true`
  Upload returns immediately, then the server optimizes video in background.
- `ARCHIVE_AFTER_DAYS=30`
  Files older than 30 days become archive candidates.
- `ARCHIVE_PROVIDER`
  Allowed: `none`, `google-drive`, `s3`
- `ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS`
  Only set to `true` after you confirm archive playback/download works.

## Google Drive archive

Use this when you want archived media in a shared Drive folder.

Required env vars:

```env
ARCHIVE_PROVIDER=google-drive
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_DRIVE_PUBLIC_LINKS=true
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Notes:

- Share the target Drive folder with the service account email as `Editor`.
- `GOOGLE_DRIVE_PUBLIC_LINKS=true` is required if you want cold-tier media to still open directly from the site after primary storage is deleted.
- If you only want Drive as backup and keep Supabase primary files, you can leave:

```env
ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false
```

## S3-compatible archive

Use this for Cloudflare R2, Backblaze B2 S3 API, MinIO, Wasabi, AWS S3, etc.

Required env vars:

```env
ARCHIVE_PROVIDER=s3
ARCHIVE_S3_BUCKET=your-bucket
ARCHIVE_S3_REGION=auto
ARCHIVE_S3_ENDPOINT=https://your-endpoint
ARCHIVE_S3_ACCESS_KEY_ID=...
ARCHIVE_S3_SECRET_ACCESS_KEY=...
ARCHIVE_S3_PUBLIC_BASE_URL=https://public-base-url-for-your-bucket
```

Optional:

```env
ARCHIVE_S3_FORCE_PATH_STYLE=true
```

Notes:

- `ARCHIVE_S3_PUBLIC_BASE_URL` should be a public URL prefix that can directly serve archived files.
- Example for R2: a custom public domain or public bucket domain.
- If `ARCHIVE_S3_PUBLIC_BASE_URL` is missing, archive can still be used as backup, but cold-tier public playback should stay off.

## Safe rollout order

1. Deploy code with:

```env
ASYNC_VIDEO_TRANSCODE=true
ARCHIVE_PROVIDER=none
```

2. Verify:
   - image upload works
   - video upload returns immediately
   - thumbnail appears in gallery/display
   - teacher dashboard can manually run transcode queue

3. Configure Google Drive or S3 archive with:

```env
ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false
```

4. Verify:
   - teacher dashboard can manually run archive queue
   - archived files still download correctly
   - old works still open normally

5. Only then consider:

```env
ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=true
```

## Operational notes

- Teacher dashboard now exposes:
  - transcode queue manual run
  - archive queue manual run
  - media pipeline stats
- ZIP export now follows the resolved media URL, so archived works can still be exported.
- Gallery and display pages prefer thumbnails, reducing classroom render cost.
