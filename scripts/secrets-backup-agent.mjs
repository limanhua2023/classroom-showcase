import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
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
dotenv.config({ path: path.join(projectRoot, '.env.secrets-backup'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.secrets-backup.local'), override: true });

const STATUS_BUCKET = 'submissions';
const DEFAULT_STATUS_PATH = String(process.env.SECRETS_BACKUP_STATUS_PATH || 'system/project-secrets-backup-status.json').trim();
const DEFAULT_CLOUD_PREFIX = String(process.env.SECRETS_BACKUP_CLOUD_PREFIX || 'classshow-system-backups/secrets').trim().replace(/^\/+|\/+$/g, '');
const DEFAULT_RETENTION = 20;
const DEFAULT_SOURCE_FILES = String(process.env.SECRETS_BACKUP_SOURCE_FILES || '.env,.env.local-backup.local,.env.project-backup.local,.env.render-backup.local')
  .split(',')
  .map(item => String(item || '').trim())
  .filter(Boolean);
const KDF_ITERATIONS = 210000;

function printHelp() {
  console.log(`
ClassShow Secrets Backup Agent

Usage:
  node scripts/secrets-backup-agent.mjs --once

Options:
  --once                  Create one encrypted secrets bundle and optional cloud upload.
  --output <path>         Override SECRETS_BACKUP_ROOT.
  --passphrase <value>    Override SECRETS_BACKUP_PASSPHRASE.
  --source <path>         Add one source file to the encrypted bundle.
  --skip-cloud            Skip the R2 upload and only keep the local bundle.
  --help                  Show this message.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SECRETS_BACKUP_ROOT
  SECRETS_BACKUP_RETENTION
  SECRETS_BACKUP_STATUS_PATH
  SECRETS_BACKUP_SOURCE_FILES
  SECRETS_BACKUP_PASSPHRASE
  SECRETS_BACKUP_PASSPHRASE_HINT
  SECRETS_BACKUP_S3_BUCKET
  SECRETS_BACKUP_S3_REGION
  SECRETS_BACKUP_S3_ENDPOINT
  SECRETS_BACKUP_S3_ACCESS_KEY_ID
  SECRETS_BACKUP_S3_SECRET_ACCESS_KEY
  SECRETS_BACKUP_CLOUD_PREFIX
`);
}

function parseArgs(argv) {
  const parsed = {
    once: false,
    skipCloud: false,
    sourceFiles: []
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
      case '--passphrase':
        parsed.passphrase = argv[++index];
        break;
      case '--source':
        parsed.sourceFiles.push(argv[++index]);
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

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function resolveSupabaseKey() {
  return String(
    process.env.SECRETS_BACKUP_SUPABASE_SERVICE_ROLE_KEY
    || process.env.PROJECT_BACKUP_SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || ''
  ).trim();
}

function resolveCloudConfig(args) {
  return {
    enabled: !args.skipCloud,
    bucket: String(process.env.SECRETS_BACKUP_S3_BUCKET || process.env.PROJECT_BACKUP_S3_BUCKET || process.env.ARCHIVE_S3_BUCKET || '').trim(),
    region: String(process.env.SECRETS_BACKUP_S3_REGION || process.env.PROJECT_BACKUP_S3_REGION || process.env.ARCHIVE_S3_REGION || 'auto').trim() || 'auto',
    endpoint: String(process.env.SECRETS_BACKUP_S3_ENDPOINT || process.env.PROJECT_BACKUP_S3_ENDPOINT || process.env.ARCHIVE_S3_ENDPOINT || '').trim(),
    accessKeyId: String(process.env.SECRETS_BACKUP_S3_ACCESS_KEY_ID || process.env.PROJECT_BACKUP_S3_ACCESS_KEY_ID || process.env.ARCHIVE_S3_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.SECRETS_BACKUP_S3_SECRET_ACCESS_KEY || process.env.PROJECT_BACKUP_S3_SECRET_ACCESS_KEY || process.env.ARCHIVE_S3_SECRET_ACCESS_KEY || '').trim(),
    prefix: DEFAULT_CLOUD_PREFIX
  };
}

function resolveConfig(args) {
  const backupRoot = path.resolve(args.output || process.env.SECRETS_BACKUP_ROOT || path.join(projectRoot, 'secrets_backup'));
  const sourceFiles = [...new Set([...DEFAULT_SOURCE_FILES, ...(args.sourceFiles || [])].map(item => String(item || '').trim()).filter(Boolean))];
  const retention = Math.max(5, Number(process.env.SECRETS_BACKUP_RETENTION || DEFAULT_RETENTION));
  const passphrase = String(args.passphrase || process.env.SECRETS_BACKUP_PASSPHRASE || '').trim();
  const passphraseHint = String(process.env.SECRETS_BACKUP_PASSPHRASE_HINT || '').trim();
  const supabaseUrl = String(process.env.SECRETS_BACKUP_SUPABASE_URL || process.env.PROJECT_BACKUP_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const supabaseKey = resolveSupabaseKey();
  const cloud = resolveCloudConfig(args);
  return {
    backupRoot,
    snapshotRoot: path.join(backupRoot, 'snapshots'),
    reportRoot: path.join(backupRoot, 'reports'),
    statusPath: DEFAULT_STATUS_PATH,
    retention,
    startedAt: new Date().toISOString(),
    sourceFiles,
    passphrase,
    passphraseHint,
    supabaseUrl,
    supabaseKey,
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

async function uploadStatusDocument(bucket, statusPath, payload) {
  const bytes = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  const { error } = await bucket.upload(statusPath, bytes, {
    upsert: true,
    contentType: 'application/json'
  });
  if (error) throw error;
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

function resolveSourceFiles(config) {
  return config.sourceFiles
    .map(relativePath => {
      const clean = String(relativePath || '').trim();
      const absolutePath = path.resolve(projectRoot, clean);
      if (!clean || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return null;
      const stat = fs.statSync(absolutePath);
      const content = fs.readFileSync(absolutePath, 'utf8');
      return {
        relativePath: clean.replace(/\\/g, '/'),
        absolutePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content,
        envSummary: summarizeEnvAssignments(content)
      };
    })
    .filter(Boolean);
}

function summarizeEnvAssignments(content) {
  const summary = {
    assignment_count: 0,
    filled_assignment_count: 0,
    empty_assignment_count: 0,
    placeholder_assignment_count: 0
  };
  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    summary.assignment_count += 1;
    const value = String(match[2] || '').trim();
    if (!value) {
      summary.empty_assignment_count += 1;
      continue;
    }
    if (/(replace_me|your[-_]|changeme|fill[-_]?me|todo|example|manual_fill_required|<.+>)/i.test(value)) {
      summary.placeholder_assignment_count += 1;
      continue;
    }
    summary.filled_assignment_count += 1;
  }
  return summary;
}

function buildCoverageSummary(config, sourceFiles) {
  const foundPaths = sourceFiles.map(file => file.relativePath);
  const expectedPaths = config.sourceFiles.map(item => String(item || '').trim().replace(/\\/g, '/')).filter(Boolean);
  const foundSet = new Set(foundPaths);
  const missingPaths = expectedPaths.filter(item => !foundSet.has(item));
  return {
    configured_source_files: expectedPaths,
    found_source_files: foundPaths,
    missing_source_files: missingPaths,
    source_file_details: sourceFiles.map(file => ({
      relative_path: file.relativePath,
      size_bytes: file.size,
      modified_at: file.modifiedAt,
      ...file.envSummary
    }))
  };
}

function buildPayloadDocument(config, sourceFiles) {
  return {
    schema_version: 'classshow-project-secrets-payload-v1',
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    source_files: sourceFiles.map(file => ({
      relative_path: file.relativePath,
      size_bytes: file.size,
      modified_at: file.modifiedAt,
      content_base64: Buffer.from(file.content, 'utf8').toString('base64')
    }))
  };
}

function encryptPayload(payloadBuffer, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    schema_version: 'classshow-project-secrets-backup-bundle-v1',
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    algorithm: 'aes-256-gcm',
    kdf: {
      name: 'pbkdf2-sha256',
      iterations: KDF_ITERATIONS,
      salt_b64: salt.toString('base64')
    },
    iv_b64: iv.toString('base64'),
    auth_tag_b64: authTag.toString('base64'),
    ciphertext_b64: encrypted.toString('base64'),
    payload_sha256: sha256Buffer(payloadBuffer)
  };
}

function createManifest(sourceFiles, bundlePath, payloadBuffer) {
  return {
    schema_version: 'classshow-project-secrets-manifest-v1',
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    bundle_name: path.basename(bundlePath),
    file_count: sourceFiles.length,
    total_bytes: sourceFiles.reduce((sum, file) => sum + Number(file.size || 0), 0),
    payload_sha256: sha256Buffer(payloadBuffer),
    files: sourceFiles.map(file => ({
      relative_path: file.relativePath,
      size_bytes: file.size,
      modified_at: file.modifiedAt,
      sha256: sha256Buffer(Buffer.from(file.content, 'utf8')),
      ...file.envSummary
    }))
  };
}

function buildStatusPayload(config, snapshot = {}, patch = {}) {
  return {
    schema_version: 'classshow-project-secrets-backup-status-v1',
    agent: 'secrets-backup-agent',
    host: os.hostname(),
    status: patch.status || snapshot.status || 'ok',
    generated_at: patch.generated_at || snapshot.generated_at || new Date().toISOString(),
    started_at: patch.started_at || snapshot.started_at || config.startedAt,
    finished_at: patch.finished_at || snapshot.finished_at || null,
    last_success_at: patch.last_success_at || snapshot.last_success_at || null,
    duration_ms: Math.max(0, Number(patch.duration_ms ?? snapshot.duration_ms ?? 0)),
    passphrase_hint: patch.passphrase_hint || snapshot.passphrase_hint || config.passphraseHint || null,
    local: patch.local || snapshot.local || {},
    cloud: patch.cloud || snapshot.cloud || {},
    coverage: patch.coverage || snapshot.coverage || {
      configured_source_files: config.sourceFiles,
      found_source_files: [],
      missing_source_files: config.sourceFiles,
      source_file_details: []
    },
    error: patch.error || snapshot.error || null
  };
}

async function runSecretsBackupOnce(config) {
  ensureDir(config.backupRoot);
  ensureDir(config.snapshotRoot);
  ensureDir(config.reportRoot);

  if (!config.passphrase) {
    throw new Error('SECRETS_BACKUP_PASSPHRASE is required before running the encrypted secrets backup agent.');
  }

  const startedAtIso = new Date().toISOString();
  const startedAt = Date.now();
  console.log(`[secrets-backup] start ${startedAtIso}`);

  const snapshotStamp = formatStamp(new Date());
  const snapshotDir = path.join(config.snapshotRoot, snapshotStamp);
  ensureDir(snapshotDir);

  const bundleFileName = `classshow_secrets_backup_${snapshotStamp}.bundle.json`;
  const manifestFileName = `classshow_secrets_backup_${snapshotStamp}.manifest.json`;
  const bundlePath = path.join(snapshotDir, bundleFileName);
  const manifestPath = path.join(snapshotDir, manifestFileName);
  const latestReportPath = path.join(config.reportRoot, 'latest-secrets-backup.json');

  try {
    const sourceFiles = resolveSourceFiles(config);
    if (!sourceFiles.length) {
      throw new Error('No source secret files were found. Check SECRETS_BACKUP_SOURCE_FILES before running the agent.');
    }
    const coverage = buildCoverageSummary(config, sourceFiles);
    const payload = buildPayloadDocument(config, sourceFiles);
    const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const bundle = encryptPayload(payloadBuffer, config.passphrase);
    const manifest = createManifest(sourceFiles, bundlePath, payloadBuffer);
    writeJson(bundlePath, bundle);
    writeJson(manifestPath, manifest);
    const bundleStat = fs.statSync(bundlePath);

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
      cloud.object_key = `${prefix}/${bundleFileName}`;
      cloud.manifest_key = `${prefix}/${manifestFileName}`;
      await putObjectFromFile(cloudClient, config.cloud.bucket, cloud.object_key, bundlePath, 'application/json');
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
      passphrase_hint: config.passphraseHint || null,
      local: {
        backup_root: config.backupRoot,
        bundle_path: bundlePath,
        manifest_path: manifestPath,
        bundle_size_bytes: bundleStat.size,
        file_count: sourceFiles.length,
        source_files: sourceFiles.map(file => file.relativePath)
      },
      cloud,
      coverage,
      bundle_sha256: sha256File(bundlePath),
      manifest_sha256: sha256File(manifestPath),
      note: cloud.uploaded
        ? 'Encrypted secrets bundle completed locally and in cloud archive.'
        : 'Encrypted secrets bundle completed locally. Cloud upload is not configured or was skipped.'
    };

    writeJson(path.join(snapshotDir, 'report.json'), report);
    writeJson(latestReportPath, report);
    pruneOldSnapshots(config.snapshotRoot, config.retention);

    const statusBucket = createSupabaseStorageBucket(config);
    if (statusBucket) {
      await uploadStatusDocument(statusBucket, config.statusPath, buildStatusPayload(config, report));
    } else {
      console.warn('[secrets-backup] Supabase status upload skipped because SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is missing.');
    }

    console.log(`[secrets-backup] files=${sourceFiles.length} bundle=${formatBytes(bundleStat.size)} cloud=${cloud.uploaded ? 'uploaded' : 'skipped'}`);
    return report;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failurePayload = buildStatusPayload(config, {}, {
      status: 'error',
      generated_at: failedAt,
      started_at: startedAtIso,
      finished_at: failedAt,
      last_success_at: null,
      duration_ms: Date.now() - startedAt,
      passphrase_hint: config.passphraseHint || null,
      local: {
        backup_root: config.backupRoot,
        bundle_path: bundlePath,
        manifest_path: manifestPath,
        bundle_size_bytes: fs.existsSync(bundlePath) ? fs.statSync(bundlePath).size : 0,
        file_count: 0,
        source_files: []
      },
      cloud: {
        provider: 's3',
        bucket: config.cloud.bucket || null,
        object_key: null,
        manifest_key: null,
        uploaded: false
      },
      coverage: {
        configured_source_files: config.sourceFiles,
        found_source_files: [],
        missing_source_files: config.sourceFiles,
        source_file_details: []
      },
      error: error.message || String(error)
    });

    const statusBucket = createSupabaseStorageBucket(config);
    if (statusBucket) {
      try {
        await uploadStatusDocument(statusBucket, config.statusPath, failurePayload);
      } catch (uploadError) {
        console.warn(`[secrets-backup] failed to upload failure heartbeat: ${uploadError.message}`);
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
  await runSecretsBackupOnce(config);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
