import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local-backup'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.local-backup.local'), override: true });

const STORAGE_BUCKET = 'submissions';
const STORAGE_FOLDERS = ['uploads', 'videos', 'thumbs', 'manifests', 'trash', 'system'];
const STATE_VERSION = 1;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_REPORT_RETENTION = 40;
const LOCAL_BACKUP_STATUS_PATH = String(process.env.LOCAL_BACKUP_STATUS_PATH || 'system/local-backup-status.json').trim();

function printHelp() {
  console.log(`
ClassShow Local Backup Agent

Usage:
  node scripts/local-backup-agent.mjs --once
  node scripts/local-backup-agent.mjs --watch

Options:
  --once                   Run a single sync and exit.
  --watch                  Keep syncing on an interval.
  --output <path>          Override LOCAL_BACKUP_ROOT.
  --course-name <name>     Only back up one course.
  --activity-id <id>       Only back up one activity.
  --invite-code <code>     Only back up one invite code.
  --interval-ms <ms>       Override LOCAL_BACKUP_INTERVAL_MS.
  --concurrency <n>        Override LOCAL_BACKUP_CONCURRENCY.
  --include-trash          Include storage trash files.
  --exclude-trash          Skip storage trash files.
  --help                   Show this help message.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY
  LOCAL_BACKUP_ROOT
  LOCAL_BACKUP_INTERVAL_MS
  LOCAL_BACKUP_CONCURRENCY
  LOCAL_BACKUP_INCLUDE_TRASH
  LOCAL_BACKUP_REPORT_RETENTION
`);
}

function parseArgs(argv) {
  const parsed = {
    once: false,
    watch: false,
    includeTrash: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--once':
        parsed.once = true;
        break;
      case '--watch':
        parsed.watch = true;
        break;
      case '--include-trash':
        parsed.includeTrash = true;
        break;
      case '--exclude-trash':
        parsed.includeTrash = false;
        break;
      case '--output':
        parsed.output = argv[++index];
        break;
      case '--course-name':
        parsed.courseName = argv[++index];
        break;
      case '--activity-id':
        parsed.activityId = argv[++index];
        break;
      case '--invite-code':
        parsed.inviteCode = argv[++index];
        break;
      case '--interval-ms':
        parsed.intervalMs = Number(argv[++index] || 0);
        break;
      case '--concurrency':
        parsed.concurrency = Number(argv[++index] || 0);
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.once && parsed.watch) {
    throw new Error('Use either --once or --watch, not both.');
  }

  return parsed;
}

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^true$/i.test(String(value).trim());
}

function normalizeInviteCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sanitizeSlugSegment(value = '', fallback = 'item') {
  const result = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return result || fallback;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestampStamp(date = new Date()) {
  const iso = toIso(date) || new Date().toISOString();
  return iso.replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function uploadJsonDocument(bucket, remotePath, value) {
  const payload = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  const { error } = await bucket.upload(remotePath, payload, {
    upsert: true,
    contentType: 'application/json'
  });
  if (error) throw error;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function chunk(array, size) {
  const result = [];
  for (let index = 0; index < array.length; index += size) {
    result.push(array.slice(index, index + size));
  }
  return result;
}

async function runPool(items, worker, concurrency) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function resolveSupabaseKey() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_ANON_KEY
    || ''
  ).trim();
}

function resolveSupabaseKeyType(key = '') {
  if (!key) return 'missing';
  if (key.startsWith('sb_secret_')) return 'service_role';
  if (key.startsWith('sb_publishable_')) return 'anon';
  return 'unknown';
}

function resolveConfig(args) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseKey = resolveSupabaseKey();
  const backupRoot = path.resolve(args.output || process.env.LOCAL_BACKUP_ROOT || path.join(projectRoot, 'local_backup'));
  const intervalMs = Number.isFinite(args.intervalMs) && args.intervalMs > 0
    ? args.intervalMs
    : Math.max(30 * 1000, Number(process.env.LOCAL_BACKUP_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  const concurrency = Number.isFinite(args.concurrency) && args.concurrency > 0
    ? Math.max(1, Math.floor(args.concurrency))
    : Math.max(1, Math.floor(Number(process.env.LOCAL_BACKUP_CONCURRENCY || DEFAULT_CONCURRENCY)));
  const includeTrash = args.includeTrash === null
    ? boolFromEnv(process.env.LOCAL_BACKUP_INCLUDE_TRASH, true)
    : !!args.includeTrash;
  const reportRetention = Math.max(5, Number(process.env.LOCAL_BACKUP_REPORT_RETENTION || DEFAULT_REPORT_RETENTION));

  if (!supabaseUrl) throw new Error('SUPABASE_URL is required.');
  if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required for local backup.');

  return {
    mode: args.watch ? 'watch' : 'once',
    supabaseUrl,
    supabaseKey,
    supabaseKeyType: resolveSupabaseKeyType(supabaseKey),
    backupRoot,
    currentRoot: path.join(backupRoot, 'current'),
    metadataRoot: path.join(backupRoot, 'current', 'metadata'),
    activityRoot: path.join(backupRoot, 'current', 'activities'),
    storageRoot: path.join(backupRoot, 'current', 'storage'),
    reportRoot: path.join(backupRoot, 'reports'),
    stateFile: path.join(backupRoot, '.classshow-backup-state.json'),
    intervalMs,
    concurrency,
    includeTrash,
    reportRetention,
    courseName: String(args.courseName || process.env.LOCAL_BACKUP_COURSE_NAME || '').trim(),
    activityId: String(args.activityId || process.env.LOCAL_BACKUP_ACTIVITY_ID || '').trim(),
    inviteCode: normalizeInviteCode(args.inviteCode || process.env.LOCAL_BACKUP_INVITE_CODE || ''),
    startedAt: new Date().toISOString()
  };
}

function createSupabaseClient(config) {
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function loadState(stateFile) {
  const state = readJson(stateFile, null);
  if (!state || typeof state !== 'object') {
    return { version: STATE_VERSION, files: {}, last_run: null };
  }
  return {
    version: STATE_VERSION,
    files: typeof state.files === 'object' && state.files ? state.files : {},
    last_run: state.last_run || null
  };
}

function saveState(stateFile, state) {
  writeJson(stateFile, {
    version: STATE_VERSION,
    last_run: state.last_run || null,
    files: state.files || {}
  });
}

function buildStorageFingerprint(item) {
  return `${item.path}::${String(item.updated_at || '')}::${String(item.size || 0)}`;
}

async function listStorageFolder(bucket, folder) {
  const files = [];
  let offset = 0;
  while (true) {
    const { data, error } = await bucket.list(folder, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;
    for (const item of data) {
      if (!item?.name) continue;
      files.push({
        folder,
        name: item.name,
        path: `${folder}/${item.name}`,
        size: Number(item.metadata?.size || 0),
        created_at: item.created_at || null,
        updated_at: item.updated_at || null,
        metadata: item.metadata || {}
      });
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return files;
}

async function listAllStorageObjects(bucket, includeTrash) {
  const folders = includeTrash ? STORAGE_FOLDERS : STORAGE_FOLDERS.filter(item => item !== 'trash');
  const results = await Promise.all(folders.map(folder => listStorageFolder(bucket, folder).catch(error => {
    console.warn(`[backup] storage list skipped for ${folder}: ${error.message}`);
    return [];
  })));
  return results.flat().sort((left, right) => left.path.localeCompare(right.path));
}

async function downloadStorageObject(bucket, remotePath, localPath) {
  const { data, error } = await bucket.download(remotePath);
  if (error) throw error;
  ensureDir(path.dirname(localPath));
  const tempPath = `${localPath}.tmp`;
  const body = typeof data?.stream === 'function' ? data.stream() : null;
  if (body) {
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(tempPath));
  } else {
    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(tempPath, buffer);
  }
  fs.renameSync(tempPath, localPath);
}

async function syncStorageFiles(bucket, config, state) {
  const storageObjects = await listAllStorageObjects(bucket, config.includeTrash);
  const remotePathSet = new Set(storageObjects.map(item => item.path));
  const report = {
    scanned: storageObjects.length,
    downloaded: 0,
    skipped: 0,
    failed: [],
    stale_local_files: []
  };

  await runPool(storageObjects, async item => {
    const localPath = path.join(config.storageRoot, ...item.path.split('/'));
    const relativeLocalPath = path.relative(config.currentRoot, localPath).replace(/\\/g, '/');
    const fingerprint = buildStorageFingerprint(item);
    const previous = state.files[item.path] || null;

    if (
      previous
      && previous.fingerprint === fingerprint
      && previous.local_relative_path === relativeLocalPath
      && fs.existsSync(localPath)
    ) {
      report.skipped += 1;
      return;
    }

    try {
      await downloadStorageObject(bucket, item.path, localPath);
      const stat = fs.statSync(localPath);
      state.files[item.path] = {
        fingerprint,
        size: stat.size,
        updated_at: item.updated_at,
        downloaded_at: new Date().toISOString(),
        local_relative_path: relativeLocalPath
      };
      report.downloaded += 1;
    } catch (error) {
      report.failed.push({ path: item.path, error: error.message });
    }
  }, config.concurrency);

  for (const [remotePath, meta] of Object.entries(state.files)) {
    if (remotePathSet.has(remotePath)) continue;
    report.stale_local_files.push({
      path: remotePath,
      local_relative_path: meta?.local_relative_path || null
    });
  }

  return { storageObjects, report };
}

async function fetchPagedRows(queryFactory, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return rows;
}

async function fetchActivities(client, config) {
  const filters = {
    activityId: config.activityId || null,
    inviteCode: config.inviteCode || null,
    courseName: config.courseName || null
  };

  let activities = await fetchPagedRows((from, to) => {
    let query = client.from('activities').select('*').order('created_at', { ascending: true }).range(from, to);
    if (filters.activityId) query = query.eq('id', filters.activityId);
    if (filters.inviteCode) query = query.eq('invite_code', filters.inviteCode);
    if (filters.courseName) query = query.eq('course_name', filters.courseName);
    return query;
  });

  if (!filters.activityId && !filters.inviteCode && filters.courseName) {
    activities = activities.filter(item => String(item.course_name || '').trim() === filters.courseName);
  }

  return activities;
}

async function fetchRowsByActivityIds(client, table, activityIds) {
  if (!activityIds.length) return [];
  const chunks = chunk(activityIds, 100);
  const rows = [];
  for (const group of chunks) {
    const batch = await fetchPagedRows((from, to) => {
      return client.from(table).select('*').in('activity_id', group).order('id', { ascending: true }).range(from, to);
    });
    rows.push(...batch);
  }
  return rows;
}

async function fetchOptionalRowsByActivityIds(client, table, activityIds) {
  try {
    return await fetchRowsByActivityIds(client, table, activityIds);
  } catch (error) {
    if (/does not exist|schema cache|column/i.test(String(error.message || ''))) {
      console.warn(`[backup] optional table skipped: ${table} (${error.message})`);
      return [];
    }
    throw error;
  }
}

function safeRelativeFromCurrent(config, remotePath) {
  if (!remotePath) return null;
  return path.join('storage', ...String(remotePath).split('/')).replace(/\\/g, '/');
}

function readManifestFromBackup(config, submissionId) {
  const manifestRelative = safeRelativeFromCurrent(config, `manifests/${submissionId}.json`);
  if (!manifestRelative) return { manifest: null, relativePath: null };
  const manifestPath = path.join(config.currentRoot, manifestRelative);
  return {
    manifest: readJson(manifestPath, null),
    relativePath: fs.existsSync(manifestPath) ? manifestRelative : null
  };
}

function enrichSubmissionForBackup(config, submission) {
  const mediaRelative = safeRelativeFromCurrent(config, submission.storage_path || null);
  const { manifest, relativePath: manifestRelative } = readManifestFromBackup(config, submission.id);
  const thumbnailRelative = safeRelativeFromCurrent(config, manifest?.thumbnail_path || null);
  return {
    ...submission,
    _backup: {
      media_relative_path: mediaRelative,
      media_exists: mediaRelative ? fs.existsSync(path.join(config.currentRoot, mediaRelative)) : false,
      manifest_relative_path: manifestRelative,
      manifest_exists: manifestRelative ? fs.existsSync(path.join(config.currentRoot, manifestRelative)) : false,
      thumbnail_relative_path: thumbnailRelative,
      thumbnail_exists: thumbnailRelative ? fs.existsSync(path.join(config.currentRoot, thumbnailRelative)) : false,
      manifest: manifest || null
    }
  };
}

function buildCourseCatalog(activities, submissions, learningSessions, courseRuntimeProgress) {
  const map = new Map();
  for (const activity of activities) {
    const courseName = String(activity.course_name || '').trim() || 'Uncategorized';
    if (!map.has(courseName)) {
      map.set(courseName, {
        course_name: courseName,
        activity_count: 0,
        submission_count: 0,
        learning_session_count: 0,
        runtime_progress_count: 0,
        invite_codes: []
      });
    }
    const entry = map.get(courseName);
    entry.activity_count += 1;
    if (activity.invite_code) entry.invite_codes.push(activity.invite_code);
  }
  for (const submission of submissions) {
    const activity = activities.find(item => item.id === submission.activity_id);
    if (!activity) continue;
    const entry = map.get(String(activity.course_name || '').trim() || 'Uncategorized');
    if (entry) entry.submission_count += 1;
  }
  for (const session of learningSessions) {
    const activity = activities.find(item => item.id === session.activity_id);
    if (!activity) continue;
    const entry = map.get(String(activity.course_name || '').trim() || 'Uncategorized');
    if (entry) entry.learning_session_count += 1;
  }
  for (const item of courseRuntimeProgress) {
    const activity = activities.find(row => row.id === item.activity_id);
    if (!activity) continue;
    const entry = map.get(String(activity.course_name || '').trim() || 'Uncategorized');
    if (entry) entry.runtime_progress_count += 1;
  }
  return [...map.values()].sort((left, right) => left.course_name.localeCompare(right.course_name));
}

function buildActivityDirectoryName(activity) {
  const invite = sanitizeSlugSegment(activity.invite_code || activity.id || 'activity', 'activity');
  const name = sanitizeSlugSegment(activity.activity_name || 'activity', 'activity');
  return `${invite}_${name}`;
}

function buildActivitySnapshot(config, activity, context) {
  const activityId = activity.id;
  const userRows = context.users.filter(item => item.activity_id === activityId);
  const rosterRows = context.studentRoster.filter(item => item.activity_id === activityId);
  const submissionRows = context.submissions
    .filter(item => item.activity_id === activityId)
    .map(item => enrichSubmissionForBackup(config, item));
  const submissionIdSet = new Set(submissionRows.map(item => item.id));
  const userIdSet = new Set(userRows.map(item => item.id));
  return {
    schema_version: 'classshow-local-backup-activity-v1',
    generated_at: new Date().toISOString(),
    activity,
    users: userRows,
    student_roster: rosterRows,
    submissions: submissionRows,
    ratings: context.ratings.filter(item => item.activity_id === activityId || submissionIdSet.has(item.submission_id)),
    comments: context.comments.filter(item => item.activity_id === activityId || submissionIdSet.has(item.submission_id) || userIdSet.has(item.user_id)),
    views: context.views.filter(item => item.activity_id === activityId || submissionIdSet.has(item.submission_id)),
    activity_feedback_likes: context.feedbackLikes.filter(item => item.activity_id === activityId),
    student_learning_sessions: context.learningSessions.filter(item => item.activity_id === activityId),
    student_course_runtime_progress: context.courseRuntimeProgress.filter(item => item.activity_id === activityId)
  };
}

function pruneOldReports(reportRoot, retention) {
  if (!fs.existsSync(reportRoot)) return;
  const entries = fs.readdirSync(reportRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^backup-report_.*\.json$/i.test(entry.name))
    .map(entry => ({
      name: entry.name,
      fullPath: path.join(reportRoot, entry.name),
      mtimeMs: fs.statSync(path.join(reportRoot, entry.name)).mtimeMs
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const entry of entries.slice(retention)) {
    try {
      fs.unlinkSync(entry.fullPath);
    } catch {}
  }
}

function buildCloudStatusPayload(config, report = {}, patch = {}) {
  return {
    schema_version: 'classshow-local-backup-status-v1',
    agent: 'local-backup-agent',
    host: os.hostname(),
    status: patch.status || report.status || 'ok',
    mode: config.mode,
    generated_at: patch.generated_at || report.generated_at || new Date().toISOString(),
    started_at: patch.started_at || report.started_at || config.startedAt || new Date().toISOString(),
    finished_at: patch.finished_at || report.finished_at || report.generated_at || null,
    last_success_at: patch.last_success_at || report.last_success_at || report.generated_at || null,
    duration_ms: Math.max(0, Number(patch.duration_ms ?? report.duration_ms ?? 0)),
    backup_root: config.backupRoot,
    report_path: patch.report_path || report.report_path || 'reports/latest-report.json',
    report_payload_sha256: patch.report_payload_sha256 || report.report_payload_sha256 || null,
    scope: patch.scope || report.scope || {
      course_name: config.courseName || null,
      activity_id: config.activityId || null,
      invite_code: config.inviteCode || null
    },
    supabase: patch.supabase || report.supabase || {
      url: config.supabaseUrl,
      key_type: config.supabaseKeyType
    },
    storage: patch.storage || report.storage || {},
    tables: patch.tables || report.tables || {},
    course_count: Math.max(0, Number(patch.course_count ?? report.course_count ?? 0)),
    storage_failures: patch.storage_failures || report.storage_failures || [],
    stale_local_files: patch.stale_local_files || report.stale_local_files || [],
    error: patch.error || report.error || null
  };
}

async function runBackupOnce(config) {
  const client = createSupabaseClient(config);
  const bucket = client.storage.from(STORAGE_BUCKET);
  const state = loadState(config.stateFile);
  ensureDir(config.backupRoot);
  ensureDir(config.currentRoot);
  ensureDir(config.metadataRoot);
  ensureDir(config.activityRoot);
  ensureDir(config.storageRoot);
  ensureDir(config.reportRoot);

  const startedAtIso = new Date().toISOString();
  console.log(`[backup] start ${startedAtIso} mode=${config.mode} root=${config.backupRoot}`);
  console.log(`[backup] supabase key type: ${config.supabaseKeyType}`);

  const startedAt = Date.now();
  try {
    const { storageObjects, report: storageReport } = await syncStorageFiles(bucket, config, state);
    const activities = await fetchActivities(client, config);
    const activityIds = activities.map(item => item.id).filter(Boolean);

    const [
      users,
      studentRoster,
      submissions,
      ratings,
      comments,
      views,
      feedbackLikes,
      learningSessions,
      courseRuntimeProgress
    ] = await Promise.all([
      fetchRowsByActivityIds(client, 'users', activityIds),
      fetchOptionalRowsByActivityIds(client, 'student_roster', activityIds),
      fetchRowsByActivityIds(client, 'submissions', activityIds),
      fetchOptionalRowsByActivityIds(client, 'ratings', activityIds),
      fetchOptionalRowsByActivityIds(client, 'comments', activityIds),
      fetchOptionalRowsByActivityIds(client, 'views', activityIds),
      fetchOptionalRowsByActivityIds(client, 'activity_feedback_likes', activityIds),
      fetchOptionalRowsByActivityIds(client, 'student_learning_sessions', activityIds),
      fetchOptionalRowsByActivityIds(client, 'student_course_runtime_progress', activityIds)
    ]);

    const generatedAt = new Date().toISOString();
    const courseCatalog = buildCourseCatalog(activities, submissions, learningSessions, courseRuntimeProgress);

    writeJson(path.join(config.metadataRoot, 'activities.json'), activities);
    writeJson(path.join(config.metadataRoot, 'users.json'), users);
    writeJson(path.join(config.metadataRoot, 'student_roster.json'), studentRoster);
    writeJson(path.join(config.metadataRoot, 'submissions.json'), submissions.map(item => enrichSubmissionForBackup(config, item)));
    writeJson(path.join(config.metadataRoot, 'ratings.json'), ratings);
    writeJson(path.join(config.metadataRoot, 'comments.json'), comments);
    writeJson(path.join(config.metadataRoot, 'views.json'), views);
    writeJson(path.join(config.metadataRoot, 'activity_feedback_likes.json'), feedbackLikes);
    writeJson(path.join(config.metadataRoot, 'student_learning_sessions.json'), learningSessions);
    writeJson(path.join(config.metadataRoot, 'student_course_runtime_progress.json'), courseRuntimeProgress);
    writeJson(path.join(config.metadataRoot, 'course_catalog.json'), courseCatalog);

    const activityIndex = [];
    for (const activity of activities) {
      const courseFolder = sanitizeSlugSegment(activity.course_name || 'uncategorized', 'uncategorized');
      const activityFolder = buildActivityDirectoryName(activity);
      const outputDir = path.join(config.activityRoot, courseFolder, activityFolder);
      ensureDir(outputDir);
      const snapshot = buildActivitySnapshot(config, activity, {
        users,
        studentRoster,
        submissions,
        ratings,
        comments,
        views,
        feedbackLikes,
        learningSessions,
        courseRuntimeProgress
      });
      writeJson(path.join(outputDir, 'snapshot.json'), snapshot);
      activityIndex.push({
        course_name: activity.course_name,
        activity_name: activity.activity_name,
        invite_code: activity.invite_code,
        activity_id: activity.id,
        relative_path: path.relative(config.currentRoot, path.join(outputDir, 'snapshot.json')).replace(/\\/g, '/')
      });
    }
    writeJson(path.join(config.activityRoot, 'index.json'), activityIndex);

    const systemSummary = {
      schema_version: 'classshow-local-backup-run-v1',
      generated_at: generatedAt,
      started_at: startedAtIso,
      finished_at: generatedAt,
      scope: {
        course_name: config.courseName || null,
        activity_id: config.activityId || null,
        invite_code: config.inviteCode || null
      },
      supabase: {
        url: config.supabaseUrl,
        key_type: config.supabaseKeyType
      },
      storage: {
        bucket: STORAGE_BUCKET,
        object_count: storageObjects.length,
        downloaded_count: storageReport.downloaded,
        skipped_count: storageReport.skipped,
        failed_count: storageReport.failed.length,
        stale_local_file_count: storageReport.stale_local_files.length
      },
      tables: {
        activities: activities.length,
        users: users.length,
        student_roster: studentRoster.length,
        submissions: submissions.length,
        ratings: ratings.length,
        comments: comments.length,
        views: views.length,
        activity_feedback_likes: feedbackLikes.length,
        student_learning_sessions: learningSessions.length,
        student_course_runtime_progress: courseRuntimeProgress.length
      },
      course_count: courseCatalog.length
    };
    writeJson(path.join(config.metadataRoot, 'system_summary.json'), systemSummary);

    state.last_run = generatedAt;
    saveState(config.stateFile, state);

    const report = {
      ...systemSummary,
      status: 'ok',
      duration_ms: Date.now() - startedAt,
      storage_failures: storageReport.failed,
      stale_local_files: storageReport.stale_local_files
    };
    const reportPayloadSha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify(report))
      .digest('hex');
    report.report_payload_sha256 = reportPayloadSha256;
    report.report_path = 'reports/latest-report.json';
    const reportPath = path.join(config.reportRoot, `backup-report_${timestampStamp(generatedAt)}.json`);
    writeJson(reportPath, report);
    writeJson(path.join(config.reportRoot, 'latest-report.json'), report);
    pruneOldReports(config.reportRoot, config.reportRetention);

    await uploadJsonDocument(bucket, LOCAL_BACKUP_STATUS_PATH, buildCloudStatusPayload(config, report, {
      report_payload_sha256: reportPayloadSha256,
      started_at: startedAtIso,
      finished_at: generatedAt,
      last_success_at: generatedAt
    }));

    console.log(
      `[backup] done activities=${activities.length} submissions=${submissions.length} downloaded=${storageReport.downloaded} skipped=${storageReport.skipped} failed=${storageReport.failed.length}`
    );
    return report;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failurePayload = buildCloudStatusPayload(config, {}, {
      status: 'error',
      generated_at: failedAt,
      started_at: startedAtIso,
      finished_at: failedAt,
      duration_ms: Date.now() - startedAt,
      error: error.message || String(error),
      storage: {
        bucket: STORAGE_BUCKET,
        object_count: 0,
        downloaded_count: 0,
        skipped_count: 0,
        failed_count: 0,
        stale_local_file_count: 0
      },
      tables: {
        activities: 0,
        submissions: 0,
        student_learning_sessions: 0,
        student_course_runtime_progress: 0
      },
      storage_failures: []
    });
    try {
      await uploadJsonDocument(bucket, LOCAL_BACKUP_STATUS_PATH, failurePayload);
    } catch (uploadError) {
      console.warn(`[backup] failed to upload backup status: ${uploadError.message}`);
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
  if (config.mode === 'once') {
    await runBackupOnce(config);
    return;
  }

  while (true) {
    try {
      await runBackupOnce(config);
    } catch (error) {
      console.error(`[backup] run failed: ${error.stack || error.message}`);
    }
    console.log(`[backup] sleeping ${config.intervalMs} ms`);
    await new Promise(resolve => setTimeout(resolve, config.intervalMs));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
