# ClassShow Secrets Backup Agent

This agent creates an **encrypted** backup bundle for the most important local secret files, keeps a local copy, uploads the same encrypted bundle to Cloudflare R2, and reports a heartbeat back to the production system.

## What it protects

Default source files:

- `.env.local-backup.local`
- `.env.project-backup.local`
- `.env.render-backup.local`

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

3. Run once:

```powershell
npm run backup:secrets
```

4. Install the daily scheduled task:

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
