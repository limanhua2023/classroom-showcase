# Key Rotation Backup Re-Acceptance

Use this short runbook after rotating any production secret such as:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ARCHIVE_S3_ACCESS_KEY_ID`
- `ARCHIVE_S3_SECRET_ACCESS_KEY`
- `SUPER_ADMIN_PASSWORD`
- any related Google / archive credential used by maintenance flows

The goal is simple: confirm that the system is not only live, but that backup, restore, and maintenance automation still work with the new secret set.

## 1. Update production first

In Render, update the rotated values and redeploy the service.

Minimum fields to re-check:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ARCHIVE_S3_ACCESS_KEY_ID`
- `ARCHIVE_S3_SECRET_ACCESS_KEY`
- `SUPER_ADMIN_PASSWORD`
- any archive-provider credential that changed during the rotation

## 2. Update local backup source files

Keep the local backup source files aligned with production:

- `.env.project-backup.local`
- `.env.secrets-backup.local`
- `.env.local-backup.local`
- `.env.render-backup.local`

If one file still contains placeholders or stale secrets, your next backup snapshot will not be trustworthy.

## 3. Re-run backup snapshots immediately

From the project root:

```powershell
npm run backup:project
npm run backup:secrets
```

Expected result:

- latest project ZIP is rebuilt and uploaded
- latest encrypted secrets bundle is rebuilt and uploaded

## 4. Reinstall scheduled backup tasks

Reinstall all three Windows scheduled tasks so they do not keep old environment assumptions:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-local-backup-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-project-backup-task.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-secrets-backup-task.ps1
```

## 5. Check live health

Open:

```text
/api/health
```

Target state:

- `supabase_maintenance_key_type = service_role`
- `storage_maintenance_mode = service_role`
- archive provider is configured
- `project_backup_status = ok / healthy`
- `project_secrets_backup_status = ok / healthy`
- `local_backup_status = ok / healthy`
- secrets coverage is complete, with no missing or placeholder-backed source file

## 6. Do one real operator-side check

From the teacher backend:

- open the activity snapshot area
- confirm the recovery handbook entry is visible
- confirm the key-rotation guide entry is visible
- confirm activity snapshot download still works
- confirm writing a snapshot to cloud still works

Do not stop at a green health page alone.

## Acceptance standard

Treat the rotation as fully accepted only when all of the following are true:

- production has redeployed successfully
- local backup source files are updated
- project backup rerun succeeded
- encrypted secrets backup rerun succeeded
- scheduled tasks were reinstalled
- teacher-side backup entry points still open normally
- `/api/health` reports healthy backup and maintenance status

## Fast recovery command reminder

Encrypted secrets restore:

```powershell
node scripts/restore-secrets-backup.mjs --input "secrets_backup\snapshots\<timestamp>\classshow_secrets_backup_<timestamp>.bundle.json" --output ".\recovered_secrets" --passphrase "<your-passphrase>"
```

Project code backup rerun:

```powershell
npm run backup:project
```

Secrets backup rerun:

```powershell
npm run backup:secrets
```
