# ClassShow 10-Minute Disaster Recovery Runbook

This runbook is the shortest operational path for restoring the production system after a crash, local machine failure, accidental deletion, or malware damage.

Use this together with:

- `public/disaster-recovery-10min.html`
- `public/project-backup-recovery.html`
- `PROJECT_BACKUP_AGENT.md`
- `SECRETS_BACKUP_AGENT.md`

## 0. Recovery Goal

Restore the following in order:

1. codebase
2. encrypted secrets
3. Render production environment
4. backup agents
5. live acceptance checks

If any one of those is missing, the system is not fully recovered.

## 1. Freeze Changes

Before touching anything:

- stop making teacher-side deletes or maintenance changes
- stop editing Render environment variables blindly
- open `/api/health` and record the current failure state

The objective is to avoid making the failure wider while you recover.

## 2. Restore the Code ZIP

Use the latest project backup ZIP from local disk or R2.

Recommended rule:

- restore into a clean folder
- do not overwrite an unknown broken folder in place

Minimum files that must exist after unzip:

- `server.js`
- `package.json`
- `public/`
- `scripts/`
- `data/`

## 3. Restore Encrypted Secrets

Run the restore command from the latest handbook page or recovery drill page.

Template:

```powershell
node scripts/restore-secrets-backup.mjs --input "secrets_backup\snapshots\<timestamp>\classshow_secrets_backup_<timestamp>.bundle.json" --output ".\recovered_secrets" --passphrase "<your-passphrase>"
```

The passphrase must be provided by the operator. It is not stored in the bundle.

Minimum secrets that must be restored:

- `APP_SECRET`
- `SUPER_ADMIN_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- archive / R2 environment variables
- video transcode environment variables

## 4. Refill Render Production Configuration

Open the Render service and verify that production variables match the recovered secrets.

Minimum production checks:

- `APP_SECRET`
- `SUPER_ADMIN_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ARCHIVE_PROVIDER`
- `ARCHIVE_S3_BUCKET`
- `ARCHIVE_S3_REGION`
- `ARCHIVE_S3_ENDPOINT`
- `ARCHIVE_S3_ACCESS_KEY_ID`
- `ARCHIVE_S3_SECRET_ACCESS_KEY`
- `ARCHIVE_S3_FORCE_PATH_STYLE`

Then trigger a rebuild / redeploy.

## 5. Reinstall Backup Agents

After the service is back, reinstall the local scheduled tasks so continuous backup resumes.

Project backup task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-project-backup-task.ps1
```

Secrets backup task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-secrets-backup-task.ps1
```

If needed, also reinstall the local activity backup task used for Supabase activity snapshots.

## 6. 60-Second Acceptance

The recovery is complete only if all items below pass:

### API

- `/api/health` returns `ok: true`
- `supabase_ok = true`
- `local_backup_status.status = ok`
- `project_backup_status.status = ok`
- `project_secrets_backup_status.status = ok`

### Teacher Console

- teacher dashboard opens normally
- backup snapshot section loads
- hot-tier / cold-tier dashboard loads
- no generic `{"detail":"Bad Request"}` regressions

### Super Admin

- unified course console opens
- backup & recovery overview renders
- R2 dashboard renders
- Supabase hot-tier dashboard renders

### Archive

- R2 usage is visible
- archive provider is healthy
- Cloudflare budget alerts remain configured

### Backup Continuity

- scheduled tasks exist
- at least one manual run succeeds after recovery

## 7. If Recovery Fails

Use this order of diagnosis:

1. secrets restore failed
2. Render env mismatch
3. Supabase key mismatch
4. R2 credential mismatch
5. backup task not reinstalled

Do not skip directly to random code edits before checking those five items.

## 8. Evidence to Preserve

After every real recovery or drill, save:

- latest ZIP path
- latest secrets bundle path
- `/api/health` screenshot or JSON
- Render deploy version
- whether scheduled tasks were reinstalled

That evidence should also be reflected in `MAINTENANCE_LOG.md`.
