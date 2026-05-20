import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
import archiver from 'archiver';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local-backup'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.local-backup.local'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.project-backup'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.project-backup.local'), override: true });

const STATUS_BUCKET = 'submissions';
const DEFAULT_STATUS_PATH = String(process.env.PROJECT_BACKUP_STATUS_PATH || 'system/project-backup-status.json').trim();
const DEFAULT_CLOUD_PREFIX = String(process.env.PROJECT_BACKUP_CLOUD_PREFIX || 'classshow-system-backups/codebase').trim().replace(/^\/+|\/+$/g, '');
const DEFAULT_RETENTION = 20;

const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'local_backup',
  'project_backup',
  'ClassShowBackup',
  'dist'
]);

const EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store'
]);

const SECRET_FILE_NAMES = new Set([
  '.env',
  '.env.local-backup',
  '.env.local-backup.local',
  '.env.project-backup',
  '.env.project-backup.local'
]);

function printHelp() {
  console.log(`
ClassShow Project Backup Agent

Usage:
  node scripts/project-backup-agent.mjs --once

Options:
  --once               Create one local snapshot and optional cloud upload.
  --output <path>      Override PROJECT_BACKUP_ROOT.
  --include-secrets    Include local secret env files in the ZIP package.
  --skip-cloud         Skip the R2 upload and only keep the local snapshot.
  --help               Show this message.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  PROJECT_BACKUP_ROOT
  PROJECT_BACKUP_INCLUDE_SECRETS
  PROJECT_BACKUP_RETENTION
  PROJECT_BACKUP_STATUS_PATH
  PROJECT_BACKUP_S3_BUCKET
  PROJECT_BACKUP_S3_REGION
  PROJECT_BACKUP_S3_ENDPOINT
  PROJECT_BACKUP_S3_ACCESS_KEY_ID
  PROJECT_BACKUP_S3_SECRET_ACCESS_KEY
  PROJECT_BACKUP_CLOUD_PREFIX
`);
}

function parseArgs(argv) {
  const parsed = {
    once: false,
    includeSecrets: null,
    skipCloud: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--once':
        parsed.once = true;
        break;
      case '--output':
        parsed.output = argv[++index];
        break;
      case '--include-secrets':
        parsed.includeSecrets = true;
        break;
      case '--skip-cloud':
        parsed.skipCloud = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.once) parsed.once = true;
  return parsed;
}

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^true$/i.test(String(value).trim());
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatStamp(date = new Date()) {
  return (toIso(date) || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '_').replace('Z', '');
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveSupabaseKey() {
  return String(
    process.env.PROJECT_BACKUP_SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || ''
  ).trim();
}

function resolveSupabaseKeyType(key = '') {
  if (!key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'service_role';
  if (key.startsWith('sb_publishable_')) return 'anon';
  return 'unknown';
}

function resolveCloudConfig(args) {
  return {
    enabled: !args.skipCloud,
    bucket: String(process.env.PROJECT_BACKUP_S3_BUCKET || process.env.ARCHIVE_S3_BUCKET || '').trim(),
    region: String(process.env.PROJECT_BACKUP_S3_REGION || process.env.ARCHIVE_S3_REGION || 'auto').trim() || 'auto',
    endpoint: String(process.env.PROJECT_BACKUP_S3_ENDPOINT || process.env.ARCHIVE_S3_ENDPOINT || '').trim(),
    accessKeyId: String(process.env.PROJECT_BACKUP_S3_ACCESS_KEY_ID || process.env.ARCHIVE_S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.PROJECT_BACKUP_S3_SECRET_ACCESS_KEY || process.env.ARCHIVE_S3_SECRET_ACCESS_KEY || '').trim(),
    prefix: DEFAULT_CLOUD_PREFIX
  };
}

function resolveConfig(args) {
  const backupRoot = path.resolve(args.output || process.env.PROJECT_BACKUP_ROOT || path.join(projectRoot, 'project_backup'));
  const includeSecrets = args.includeSecrets === null
    ? boolFromEnv(process.env.PROJECT_BACKUP_INCLUDE_SECRETS, false)
    : !!args.includeSecrets;
  const retention = Math.max(5, Number(process.env.PROJECT_BACKUP_RETENTION || DEFAULT_RETENTION));
  const supabaseUrl = String(process.env.PROJECT_BACKUP_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const supabaseKey = resolveSupabaseKey();
  const cloud = resolveCloudConfig(args);
  return {
    backupRoot,
    snapshotRoot: path.join(backupRoot, 'snapshots'),
    reportRoot: path.join(backupRoot, 'reports'),
    includeSecrets,
    retention,
    startedAt: new Date().toISOString(),
    statusPath: DEFAULT_STATUS_PATH,
    supabaseUrl,
    supabaseKey,
    supabaseKeyType: resolveSupabaseKeyType(supabaseKey),
    cloud: {
      ...cloud,
      configured: !!(cloud.enabled && cloud.bucket && cloud.endpoint && cloud.accessKeyId && cloud.secretAccessKey)
    }
  };
}

function createSupabaseStorageBucket(config) {
  if (!config.supabaseUrl || !config.supabaseKey) return null;
  const client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  return client.storage.from(STATUS_BUCKET);
}

function createCloudClient(config) {
  if (!config.cloud.configured) return null;
  return new S3Client({
    region: config.cloud.region,
    endpoint: config.cloud.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.cloud.accessKeyId,
      secretAccessKey: config.cloud.secretAccessKey
    }
  });
}

function safeRelative(relativePath = '') {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function shouldExcludeRelativePath(relativePath, includeSecrets) {
  if (!relativePath) return false;
  const normalized = safeRelative(relativePath);
  const parts = normalized.split('/');
  if (parts.some(part => /^tmp_/i.test(part))) return true;
  if (parts.some(part => EXCLUDED_DIR_NAMES.has(part))) return true;
  const baseName = parts[parts.length - 1] || '';
  if (EXCLUDED_FILE_NAMES.has(baseName)) return true;
  if (!includeSecrets && SECRET_FILE_NAMES.has(baseName)) return true;
  if (!includeSecrets && /^\.env(\..+)?$/i.test(baseName)) return true;
  return false;
}

function collectProjectFiles(rootDir, includeSecrets, currentDir = rootDir, bucket = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = safeRelative(path.relative(rootDir, absolutePath));
    if (shouldExcludeRelativePath(relativePath, includeSecrets)) continue;
    if (entry.isDirectory()) {
      collectProjectFiles(rootDir, includeSecrets, absolutePath, bucket);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(absolutePath);
    bucket.push({
      absolutePath,
      relativePath,
      size: stat.size,
      mtime: stat.mtime.toISOString()
    });
  }
  return bucket;
}

function getGitValue(args) {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function getGitMetadata() {
  return {
    branch: getGitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: getGitValue(['rev-parse', 'HEAD'])
  };
}

function createManifest(config, files, meta = {}) {
  const manifestEntries = files.map(file => ({
    relative_path: file.relativePath,
    size_bytes: file.size,
    modified_at: file.mtime,
    sha256: sha256File(file.absolutePath)
  }));
  return {
    schema_version: 'classshow-project-backup-manifest-v1',
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    include_secrets: config.includeSecrets,
    file_count: manifestEntries.length,
    total_bytes: manifestEntries.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0),
    git: meta.git || {},
    files: manifestEntries
  };
}

async function createZipArchive(files, zipPath) {
  ensureDir(path.dirname(zipPath));
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.file(file.absolutePath, { name: file.relativePath });
    }
    archive.finalize();
  });
}

async function putObjectFromFile(client, bucket, key, localPath, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentType: contentType
  }));
}

async function putObjectFromJson(client, bucket, key, value) {
  const payload = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: payload,
    ContentType: 'application/json'
  }));
}

async function uploadStatusDocument(bucket, statusPath, payload) {
  const bytes = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  const { error } = await bucket.upload(statusPath, bytes, {
    upsert: true,
    contentType: 'application/json'
  });
  if (error) throw error;
}

function pruneOldSnapshots(snapshotRoot, retention) {
  if (!fs.existsSync(snapshotRoot)) return;
  const entries = fs.readdirSync(snapshotRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      fullPath: path.join(snapshotRoot, entry.name),
      mtimeMs: fs.statSync(path.join(snapshotRoot, entry.name)).mtimeMs
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const entry of entries.slice(retention)) {
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
  }
}

function buildStatusPayload(config, snapshot = {}, patch = {}) {
  return {
    schema_version: 'classshow-project-backup-status-v1',
    agent: 'project-backup-agent',
    host: os.hostname(),
    status: patch.status || snapshot.status || 'ok',
    generated_at: patch.generated_at || snapshot.generated_at || new Date().toISOString(),
    started_at: patch.started_at || snapshot.started_at || config.startedAt,
    finished_at: patch.finished_at || snapshot.finished_at || null,
    last_success_at: patch.last_success_at || snapshot.last_success_at || null,
    duration_ms: Math.max(0, Number(patch.duration_ms ?? snapshot.duration_ms ?? 0)),
    git_commit: patch.git_commit || snapshot.git_commit || null,
    git_branch: patch.git_branch || snapshot.git_branch || null,
    local: patch.local || snapshot.local || {},
    cloud: patch.cloud || snapshot.cloud || {},
    error: patch.error || snapshot.error || null
  };
}

async function runProjectBackupOnce(config) {
  ensureDir(config.backupRoot);
  ensureDir(config.snapshotRoot);
  ensureDir(config.reportRoot);

  const startedAtIso = new Date().toISOString();
  const startedAt = Date.now();
  console.log(`[project-backup] start ${startedAtIso}`);

  const snapshotStamp = formatStamp(new Date());
  const snapshotDir = path.join(config.snapshotRoot, snapshotStamp);
  ensureDir(snapshotDir);

  const zipFileName = `classshow_project_backup_${snapshotStamp}.zip`;
  const manifestFileName = `classshow_project_backup_${snapshotStamp}.manifest.json`;
  const zipPath = path.join(snapshotDir, zipFileName);
  const manifestPath = path.join(snapshotDir, manifestFileName);
  const latestReportPath = path.join(config.reportRoot, 'latest-project-backup.json');

  try {
    const files = collectProjectFiles(projectRoot, config.includeSecrets).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const git = getGitMetadata();
    const manifest = createManifest(config, files, { git });
    writeJson(manifestPath, manifest);
    await createZipArchive(files, zipPath);
    const zipStat = fs.statSync(zipPath);

    const cloud = {
      provider: 's3',
      bucket: config.cloud.bucket || null,
      object_key: null,
      manifest_key: null,
      uploaded: false
    };

    if (config.cloud.configured) {
      const cloudClient = createCloudClient(config);
      const prefix = `${config.cloud.prefix}/${snapshotStamp}`;
      cloud.object_key = `${prefix}/${zipFileName}`;
      cloud.manifest_key = `${prefix}/${manifestFileName}`;
      await putObjectFromFile(cloudClient, config.cloud.bucket, cloud.object_key, zipPath, 'application/zip');
      await putObjectFromJson(cloudClient, config.cloud.bucket, cloud.manifest_key, manifest);
      cloud.uploaded = true;
    }

    const generatedAt = new Date().toISOString();
    const report = {
      status: 'ok',
      generated_at: generatedAt,
      started_at: startedAtIso,
      finished_at: generatedAt,
      last_success_at: generatedAt,
      duration_ms: Date.now() - startedAt,
      git_commit: git.commit,
      git_branch: git.branch,
      local: {
        backup_root: config.backupRoot,
        zip_path: zipPath,
        manifest_path: manifestPath,
        zip_size_bytes: zipStat.size,
        file_count: files.length,
        include_secrets: config.includeSecrets
      },
      cloud,
      manifest_sha256: sha256File(manifestPath),
      zip_sha256: sha256File(zipPath),
      note: cloud.uploaded
        ? 'Project backup snapshot completed locally and in cloud archive.'
        : 'Project backup snapshot completed locally. Cloud upload is not configured or was skipped.'
    };

    writeJson(path.join(snapshotDir, 'report.json'), report);
    writeJson(latestReportPath, report);
    pruneOldSnapshots(config.snapshotRoot, config.retention);

    const statusBucket = createSupabaseStorageBucket(config);
    if (statusBucket) {
      await uploadStatusDocument(statusBucket, config.statusPath, buildStatusPayload(config, report));
    } else {
      console.warn('[project-backup] Supabase status upload skipped because SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is missing.');
    }

    console.log(`[project-backup] files=${files.length} zip=${formatBytes(zipStat.size)} cloud=${cloud.uploaded ? 'uploaded' : 'skipped'}`);
    return report;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const git = getGitMetadata();
    const failurePayload = buildStatusPayload(config, {}, {
      status: 'error',
      generated_at: failedAt,
      started_at: startedAtIso,
      finished_at: failedAt,
      last_success_at: null,
      duration_ms: Date.now() - startedAt,
      git_commit: git.commit,
      git_branch: git.branch,
      cloud: {
        provider: 's3',
        bucket: config.cloud.bucket || null,
        object_key: null,
        manifest_key: null,
        uploaded: false
      },
      local: {
        backup_root: config.backupRoot,
        zip_path: zipPath,
        manifest_path: manifestPath,
        zip_size_bytes: fs.existsSync(zipPath) ? fs.statSync(zipPath).size : 0,
        file_count: 0,
        include_secrets: config.includeSecrets
      },
      error: error.message || String(error)
    });

    const statusBucket = createSupabaseStorageBucket(config);
    if (statusBucket) {
      try {
        await uploadStatusDocument(statusBucket, config.statusPath, failurePayload);
      } catch (uploadError) {
        console.warn(`[project-backup] failed to upload failure heartbeat: ${uploadError.message}`);
      }
    }

    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const config = resolveConfig(args);
  await runProjectBackupOnce(config);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
