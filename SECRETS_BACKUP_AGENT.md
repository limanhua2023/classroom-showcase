# ClassShow Secrets Backup Agent

This agent creates an **encrypted** backup bundle for the most important local secret files, keeps a local copy, uploads the same encrypted bundle to Cloudflare R2, and reports a heartbeat back to the production system.

## What it protects

Default source files:

- `.env`
- `.env.local-backup.local`
- `.env.project-backup.local`
- `.env.render-backup.local`

Recommended coverage target:

- `.env`: local application secrets such as `APP_SECRET` and the current `SUPABASE_ANON_KEY`
- `.env.local-backup.local`: local hot-storage / USB backup agent settings
- `.env.project-backup.local`: code backup + cloud project snapshot settings
- `.env.render-backup.local`: production Render secret snapshot for fast rebuilds

You can override the list with:

- `SECRETS_BACKUP_SOURCE_FILES`
- `--source <path>`

## Encryption model

- Payload encryption: `AES-256-GCM`
- Key derivation: `PBKDF2-SHA256`
- Iterations: `210000`
- The passphrase itself is **never** uploaded to Supabase or R2
- Only the optional `SECRETS_BACKUP_PASSPHRASE_HINT` is written into the heartbeat status

## Setup

1. Copy the template:

```powershell
Copy-Item .env.secrets-backup.example .env.secrets-backup.local
```

2. Fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SECRETS_BACKUP_PASSPHRASE`
- `SECRETS_BACKUP_PASSPHRASE_HINT`
- `SECRETS_BACKUP_S3_BUCKET`
- `SECRETS_BACKUP_S3_ENDPOINT`
- `SECRETS_BACKUP_S3_ACCESS_KEY_ID`
- `SECRETS_BACKUP_S3_SECRET_ACCESS_KEY`

3. If `.env.local-backup.local` or `.env.render-backup.local` do not exist yet:

```powershell
Copy-Item .env.local-backup.example .env.local-backup.local
Copy-Item .env.render-backup.example .env.render-backup.local
```

Then fill the real values before relying on full disaster recovery. The secrets backup heartbeat will warn when configured source files are missing, or when a source file still contains empty / placeholder values.

4. Run once:

```powershell
npm run backup:secrets
```

5. Install the daily scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-secrets-backup-task.ps1
```

## Output

Local files:

- `secrets_backup/snapshots/<timestamp>/classshow_secrets_backup_<timestamp>.bundle.json`
- `secrets_backup/snapshots/<timestamp>/classshow_secrets_backup_<timestamp>.manifest.json`
- `secrets_backup/reports/latest-secrets-backup.json`

Cloud files:

- `classshow-system-backups/secrets/<timestamp>/classshow_secrets_backup_<timestamp>.bundle.json`
- `classshow-system-backups/secrets/<timestamp>/classshow_secrets_backup_<timestamp>.manifest.json`

Health heartbeat:

- `submissions/system/project-secrets-backup-status.json`

## Restore

```powershell
node scripts/restore-secrets-backup.mjs `
  --input ".\secrets_backup\snapshots\<timestamp>\classshow_secrets_backup_<timestamp>.bundle.json" `
  --output ".\recovered_secrets" `
  --passphrase "<your-passphrase>"
```

This restores the original secret files into `recovered_secrets/`.

For the full disaster-recovery drill, pair this with:

- `PROJECT_BACKUP_AGENT.md`
- `public/project-backup-recovery.html`

## Recommended passphrase practice

- Use a dedicated passphrase that is **not** reused for email or other web accounts
- Store the passphrase in an offline password manager or sealed paper copy
- Use `SECRETS_BACKUP_PASSPHRASE_HINT` only as a memory hint, not as the full answer
