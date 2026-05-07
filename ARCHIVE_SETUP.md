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
TRANSCODE_LOOP_INTERVAL_MS=120000
TRANSCODE_BATCH_SIZE=1
TRANSCODE_MIN_AGE_MS=90000
VIDEO_TRANSCODE_THREADS=1
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
- `TRANSCODE_LOOP_INTERVAL_MS`
  Automatic queue scan interval. Default is 2 minutes.
- `TRANSCODE_BATCH_SIZE`
  How many videos the background queue processes per round. Default is 1 on low-cost hosting.
- `TRANSCODE_MIN_AGE_MS`
  Newly uploaded videos wait this long before auto-transcode starts. Teacher manual run bypasses this cooldown.
- `VIDEO_TRANSCODE_THREADS`
  FFmpeg thread count. Keep it at `1` on Render free/basic instances to reduce 502 risk during background processing.

## Google Drive archive

There are now two supported Google Drive modes:

- `OAuth personal drive`
  Recommended when you want to archive into your own `My Drive` folder.
- `Service account + Shared Drive`
  Recommended when you want a team-managed archive target.

If you use a `service account` with a normal personal `My Drive` folder, Google will reject uploads with a quota error. The app now detects and blocks that configuration on purpose.

### Google Drive OAuth personal drive

Use this when you want archived media in your own Google account folder.

Required env vars:

```env
ARCHIVE_PROVIDER=google-drive
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_DRIVE_PUBLIC_LINKS=true
GOOGLE_DRIVE_CLIENT_ID=your_oauth_client_id
GOOGLE_DRIVE_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_DRIVE_REFRESH_TOKEN=your_refresh_token
```

How to get the OAuth values:

1. In Google Cloud Console, keep `Google Drive API` enabled.
2. Go to `APIs & Services -> OAuth consent screen`.
3. Choose `External`.
4. Fill the basic app name / support email / developer email.
5. Add your own Google account as a `Test user`.
6. Go to `APIs & Services -> Credentials -> Create credentials -> OAuth client ID`.
7. Choose `Desktop app`.
8. Copy the generated `Client ID` and `Client secret`.
9. In this repo, run:

```bash
npm run google-drive:oauth
```

10. Paste the `Client ID` and `Client secret` when the script asks.
11. Open the printed Google URL, sign in with the same Google account that owns the folder, and approve Drive access.
12. After the browser returns to localhost, the terminal will print:

```env
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...
```

13. Put those three values into Render `Environment`.
14. Remove `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` from Render after the switch, so the runtime is unambiguously on OAuth mode.

Notes:

- `GOOGLE_DRIVE_PUBLIC_LINKS=true` is required if you want cold-tier media to still open directly from the site after primary storage is deleted.
- If you only want Drive as backup and keep Supabase primary files, leave:

```env
ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false
```

### Google Drive service account + Shared Drive

Required env vars:

```env
ARCHIVE_PROVIDER=google-drive
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_DRIVE_PUBLIC_LINKS=true
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Notes:

- The target folder must live inside a `Shared Drive`, not inside a personal `My Drive`.
- Grant the service account `Editor` access on that Shared Drive or folder.
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
   - background transcode does not compete with live classroom uploads

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
