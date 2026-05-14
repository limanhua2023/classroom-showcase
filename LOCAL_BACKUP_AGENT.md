# ClassShow Local Backup Agent

This adds two local maintenance tools:

1. `scripts/local-backup-agent.mjs`
   - Pulls the full `submissions` storage bucket and core metadata tables to a local hard drive.
   - Writes activity snapshots, table dumps, reports, and an incremental sync state file.
2. `scripts/usb-secondary-backup.ps1`
   - Copies the current local backup to a USB drive as a safe secondary snapshot.

## 1. Configure local backup

Copy the example file:

```powershell
Copy-Item .env.local-backup.example .env.local-backup
```

Fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOCAL_BACKUP_ROOT`
- `USB_BACKUP_ROOT` (optional, for the USB script)

Use the Supabase **secret key** / service-role key on the admin machine only.

## 2. Run one local backup now

```powershell
npm run backup:local
```

This writes data under:

```text
<LOCAL_BACKUP_ROOT>\
  current\
    storage\
    metadata\
    activities\
  reports\
  .classshow-backup-state.json
```

## 3. Keep syncing while the computer is on

```powershell
npm run backup:local:watch
```

The watch mode loops forever and re-syncs on the configured interval.

## 4. Start automatically at Windows logon

Run once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-local-backup-task.ps1
```

This creates a Windows Scheduled Task named:

```text
ClassShow Local Backup Agent
```

## 5. Create a USB secondary backup

Safe snapshot copy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/usb-secondary-backup.ps1
```

Override the destination directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/usb-secondary-backup.ps1 -DestinationRoot E:\ClassShowBackup
```

Mirror the latest backup to a stable `latest\` folder on the USB drive in addition to the timestamped snapshot:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/usb-secondary-backup.ps1 -MirrorLatest
```

## What gets backed up

Storage objects:

- `uploads/`
- `videos/`
- `thumbs/`
- `manifests/`
- `trash/` (unless disabled)
- `system/`

Metadata tables:

- `activities`
- `users`
- `student_roster`
- `submissions`
- `ratings`
- `comments`
- `views`
- `activity_feedback_likes`
- `student_learning_sessions`

Activity snapshots:

- One `snapshot.json` per activity under `current/activities/<course>/<invite>_<activity>/`

## Notes

- The local backup agent does **not** delete old local files when the cloud copy disappears. It marks them as stale in the report instead.
- The USB script uses safe copy mode by default and does **not** purge old USB snapshots.
- Keep the service-role key only on trusted admin machines.
