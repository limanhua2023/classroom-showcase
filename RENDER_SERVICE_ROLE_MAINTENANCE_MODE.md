# Render Service-Role Maintenance Mode

Date: 2026-05-14

## Goal

Upgrade storage maintenance in production from anon fallback to dedicated `service_role` mode, so the following operations are more stable:

- recycle-bin hard delete
- quarantine / restore
- archive mirror / cold archive
- orphan-file cleanup
- storage diagnostics

## What changed in code

The server now uses two Supabase clients:

- app client:
  - prefers `SUPABASE_ANON_KEY`
  - falls back to `SUPABASE_SERVICE_ROLE_KEY` only if anon is missing
- maintenance client:
  - prefers `SUPABASE_SERVICE_ROLE_KEY`
  - falls back to `SUPABASE_ANON_KEY` only if service role is missing

All server-side `submissions` bucket maintenance operations now use the maintenance client.

## Render steps

1. Open Render.
2. Open service `classroom-showcase`.
3. Open `Environment`.
4. Click `Edit`.
5. Add a new variable:

   - key: `SUPABASE_SERVICE_ROLE_KEY`
   - value: copy the `service_role` key from Supabase Project Settings -> API

6. Keep existing variables unchanged:

   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - Google Drive related archive variables

7. Click `Save, rebuild, and deploy`.

## How to verify after deploy

### Option A: health endpoint

Open:

`https://classroom-showcase.onrender.com/api/health`

Expected fields:

- `"supabase_app_key_type": "anon"`
- `"supabase_maintenance_key_type": "service_role"`
- `"storage_maintenance_mode": "service_role"`

### Option B: teacher dashboard self-check

1. Open teacher dashboard.
2. Open the storage diagnostics panel.
3. Click `运行自检`.

Expected result in the diagnostics panel:

- `App key: anon`
- `Maintenance key: service_role`
- `Mode: service_role`

## If verification still shows anon fallback

Check these in order:

1. `SUPABASE_SERVICE_ROLE_KEY` exists in Render.
2. The value is the real Supabase `service_role` key, not the anon key.
3. Render deploy finished successfully.
4. `/api/health` is showing the newest deployed commit.

## Safety note

`service_role` is a privileged secret. Never expose it in frontend code, screenshots, or public logs.
