# ClassShow Project Backup Agent

This agent creates a code-and-config snapshot of the ClassShow repository, writes the snapshot to the maintainer PC, and can upload the same package to Cloudflare R2 for off-machine recovery.

## What it backs up

- `server.js`
- `public/`
- `scripts/`
- `data/`
- `package.json`
- `package-lock.json`
- SQL migration files
- Markdown / operational documents
- Optional secret env files when `PROJECT_BACKUP_INCLUDE_SECRETS=true`

Excluded by default:

- `.git/`
- `node_modules/`
- `local_backup/`
- `project_backup/`
- `ClassShowBackup/`
- `tmp_*`
- secret env files

## Setup

1. Copy the template:

```powershell
Copy-Item .env.project-backup.example .env.project-backup.local
```

2. Fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROJECT_BACKUP_S3_BUCKET`
- `PROJECT_BACKUP_S3_ENDPOINT`
- `PROJECT_BACKUP_S3_ACCESS_KEY_ID`
- `PROJECT_BACKUP_S3_SECRET_ACCESS_KEY`

3. Run once:

```powershell
npm run backup:project
```

4. Install the daily scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-project-backup-task.ps1
```

## Output

Local files:

- `project_backup/snapshots/<timestamp>/classshow_project_backup_<timestamp>.zip`
- `project_backup/snapshots/<timestamp>/classshow_project_backup_<timestamp>.manifest.json`
- `project_backup/reports/latest-project-backup.json`

Cloud files:

- `classshow-system-backups/codebase/<timestamp>/classshow_project_backup_<timestamp>.zip`
- `classshow-system-backups/codebase/<timestamp>/classshow_project_backup_<timestamp>.manifest.json`

Health heartbeat:

- `submissions/system/project-backup-status.json`

## Recovery idea

1. Download the latest ZIP from local disk or R2.
2. Restore the repository snapshot to a clean folder.
3. Restore `.env` / secret files if they were intentionally included.
4. Redeploy Render and reconnect local backup agents if needed.

## Critical config recovery checklist

The ZIP snapshot restores the codebase, but the following secrets and environment settings must still be restored separately:

- Render production env vars:
  - `APP_SECRET`
  - `SUPER_ADMIN_PASSWORD`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - archive / R2 env vars
  - video transcode env vars
- Supabase privileged secret key (`sb_secret_...`)
- Cloudflare R2:
  - bucket name
  - endpoint
  - access key ID
  - secret access key
- Local backup agents:
  - `.env.local-backup.local`
  - `.env.project-backup.local`
  - Windows scheduled tasks for both agents

Because `PROJECT_BACKUP_INCLUDE_SECRETS=false` is the recommended default, assume secret files are **not** inside the ZIP unless you explicitly changed that setting.
