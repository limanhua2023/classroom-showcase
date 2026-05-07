import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import multer from 'multer';
import archiver from 'archiver';
import QRCode from 'qrcode';
import fs from 'fs';
import crypto from 'crypto';
import readXlsxFile from 'read-excel-file/node';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';
import { google } from 'googleapis';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const APP_TIME_ZONE = 'Asia/Bangkok';

// APP_SECRET must be stable in production; otherwise all signed student/teacher tokens
// become invalid after each deploy/restart.
const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
  const msg = 'APP_SECRET is not set. Set it in Render Environment before relying on tokens in production.';
  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    console.error(msg);
    process.exit(1);
  }
  console.warn(`${msg} Using an unsafe development fallback only for local runs.`);
}
const EFFECTIVE_APP_SECRET = APP_SECRET || 'classshow-local-dev-secret-change-me';
const TEACHER_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FEEDBACK_COOLDOWN_MS = 60 * 1000;
const FEEDBACK_HISTORY_SCAN_LIMIT = 100;
const FEEDBACK_MIN_MEANINGFUL_CHARS = 3;
const DEFAULT_FEEDBACK_DAILY_LIMIT = 5;
const MAX_FEEDBACK_DAILY_LIMIT = 20;
const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const WITHDRAWN_FEEDBACK_PREFIX = '__WITHDRAWN__::';
const TMP_UPLOAD_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const STORAGE_ORPHAN_MIN_AGE_MS = 30 * 60 * 1000;
const IMAGE_MAX_DIMENSION = 1800;
const IMAGE_WEBP_QUALITY = 82;
const VIDEO_MAX_WIDTH = 1280;
const VIDEO_CRF = 30;
const VIDEO_PRESET = 'veryfast';
const VIDEO_AUDIO_BITRATE = '96k';
const VIDEO_TRANSCODE_THREADS = Math.max(1, Number(process.env.VIDEO_TRANSCODE_THREADS || 1));
const VIDEO_MAXRATE = '1600k';
const MEDIA_MANIFEST_FOLDER = 'manifests';
const MEDIA_THUMBNAIL_FOLDER = 'thumbs';
const STORAGE_TRASH_FOLDER = 'trash';
const IMAGE_THUMB_MAX_DIMENSION = 720;
const IMAGE_THUMB_QUALITY = 76;
const VIDEO_THUMB_MAX_WIDTH = 960;
const VIDEO_THUMB_CAPTURE_SECOND = 0.8;
const TRANSCODE_LOOP_INTERVAL_MS = Math.max(30 * 1000, Number(process.env.TRANSCODE_LOOP_INTERVAL_MS || 2 * 60 * 1000));
const TRANSCODE_BATCH_SIZE = Math.max(1, Number(process.env.TRANSCODE_BATCH_SIZE || 1));
const TRANSCODE_MAX_ATTEMPTS = 3;
const TRANSCODE_MIN_AGE_MS = Math.max(0, Number(process.env.TRANSCODE_MIN_AGE_MS || 90 * 1000));
const ASYNC_VIDEO_TRANSCODE = !/^false$/i.test(String(process.env.ASYNC_VIDEO_TRANSCODE || 'true'));
const ARCHIVE_LOOP_INTERVAL_MS = 15 * 60 * 1000;
const ARCHIVE_BATCH_SIZE = 2;
const ARCHIVE_MAX_ATTEMPTS = 3;
const DEFAULT_ARCHIVE_AFTER_DAYS = Math.max(0, Number(process.env.ARCHIVE_AFTER_DAYS || 30));
const ARCHIVE_PROVIDER = String(process.env.ARCHIVE_PROVIDER || 'none').trim().toLowerCase();
const DEFAULT_ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS = /^true$/i.test(String(process.env.ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS || 'false'));
const GOOGLE_DRIVE_FOLDER_ID = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
const GOOGLE_DRIVE_PUBLIC_LINKS = /^true$/i.test(String(process.env.GOOGLE_DRIVE_PUBLIC_LINKS || 'false'));
const ARCHIVE_S3_BUCKET = String(process.env.ARCHIVE_S3_BUCKET || '').trim();
const ARCHIVE_S3_REGION = String(process.env.ARCHIVE_S3_REGION || 'auto').trim();
const ARCHIVE_S3_ENDPOINT = String(process.env.ARCHIVE_S3_ENDPOINT || '').trim();
const ARCHIVE_S3_ACCESS_KEY_ID = String(process.env.ARCHIVE_S3_ACCESS_KEY_ID || '').trim();
const ARCHIVE_S3_SECRET_ACCESS_KEY = String(process.env.ARCHIVE_S3_SECRET_ACCESS_KEY || '').trim();
const ARCHIVE_S3_FORCE_PATH_STYLE = /^true$/i.test(String(process.env.ARCHIVE_S3_FORCE_PATH_STYLE || 'true'));
const ARCHIVE_S3_PUBLIC_BASE_URL = String(process.env.ARCHIVE_S3_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const STORAGE_WARNING_LIMIT_BYTES = Math.max(128 * 1024 * 1024, Number(process.env.STORAGE_WARNING_LIMIT_BYTES || 1024 * 1024 * 1024));
const STORAGE_SAFE_DELETE = !/^false$/i.test(String(process.env.STORAGE_SAFE_DELETE || 'true'));
const ARCHIVE_PERMANENT_DELETE = /^true$/i.test(String(process.env.ARCHIVE_PERMANENT_DELETE || 'false'));
const OPS_SNAPSHOT_LIST_TTL_MS = 60 * 1000;
const TASK_STUCK_GRACE_MS = 5 * 60 * 1000;

function escapeHtml(input = '') {
  const str = String(input);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(input, maxLen = 200) {
  return escapeHtml(String(input ?? '').trim()).slice(0, maxLen);
}

function formatStorageBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[index]}`;
}

function toIsoStringOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatSnapshotStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}${map.month}${map.day}_${map.hour}${map.minute}${map.second}`;
}

function createTaskHealthState(name, intervalMs, schedulerEnabled = true) {
  return {
    name,
    interval_ms: intervalMs,
    scheduler_enabled: !!schedulerEnabled,
    busy: false,
    current_origin: null,
    current_activity_id: null,
    current_started_at: null,
    last_started_at: null,
    last_finished_at: null,
    last_success_at: null,
    last_manual_started_at: null,
    last_manual_success_at: null,
    last_error: null,
    last_error_at: null,
    consecutive_failures: 0,
    last_duration_ms: null,
    last_result: null
  };
}

function taskHealthMaxBusyMs(state = {}) {
  return Math.max(TASK_STUCK_GRACE_MS, Number(state.interval_ms || 0) * 3 || TASK_STUCK_GRACE_MS);
}

function trimTaskResult(result = {}) {
  if (!result || typeof result !== 'object') return null;
  const trimmed = {
    processed: Number(result.processed || 0),
    queued: Number(result.queued || 0),
    skipped: !!result.skipped
  };
  if (result.reason) trimmed.reason = String(result.reason);
  if (result.provider?.name) {
    trimmed.provider = {
      name: result.provider.name,
      configured: !!result.provider.configured
    };
  }
  return trimmed;
}

function recordTaskRunStart(state, meta = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  state.busy = true;
  state.current_origin = meta.origin || 'loop';
  state.current_activity_id = meta.activityId ? String(meta.activityId) : null;
  state.current_started_at = nowIso;
  state.last_started_at = nowIso;
  if (state.current_origin === 'manual') state.last_manual_started_at = nowIso;
}

function recordTaskRunResult(state, result = {}, meta = {}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const startedAtMs = state.current_started_at ? new Date(state.current_started_at).getTime() : NaN;
  state.last_finished_at = nowIso;
  state.last_duration_ms = Number.isFinite(startedAtMs) ? Math.max(0, now.getTime() - startedAtMs) : null;
  state.last_result = {
    ...trimTaskResult(result),
    origin: meta.origin || state.current_origin || 'loop',
    activity_id: meta.activityId ? String(meta.activityId) : state.current_activity_id,
    finished_at: nowIso
  };
  state.busy = false;
  state.current_origin = null;
  state.current_activity_id = null;
  state.current_started_at = null;
}

function recordTaskRunSuccess(state, result = {}, meta = {}) {
  recordTaskRunResult(state, result, meta);
  const nowIso = state.last_finished_at;
  state.last_success_at = nowIso;
  state.last_error = null;
  state.last_error_at = null;
  state.consecutive_failures = 0;
  if ((meta.origin || state.last_result?.origin) === 'manual') {
    state.last_manual_success_at = nowIso;
  }
}

function recordTaskRunFailure(state, error, meta = {}) {
  recordTaskRunResult(state, {
    skipped: false,
    processed: 0,
    queued: 0,
    reason: 'failed'
  }, meta);
  state.last_error = String(error?.message || error || 'Unknown failure');
  state.last_error_at = state.last_finished_at;
  state.consecutive_failures = Number(state.consecutive_failures || 0) + 1;
  if (state.last_result) state.last_result.error = state.last_error;
}

function recordTaskRunSkip(state, result = {}, meta = {}) {
  const nowIso = new Date().toISOString();
  state.last_result = {
    ...trimTaskResult(result),
    origin: meta.origin || 'loop',
    activity_id: meta.activityId ? String(meta.activityId) : null,
    finished_at: nowIso
  };
}

function serializeTaskHealthState(state = {}) {
  const now = Date.now();
  const startedAtMs = state.current_started_at ? new Date(state.current_started_at).getTime() : NaN;
  const stuckThresholdMs = taskHealthMaxBusyMs(state);
  const isStuck = !!state.busy && Number.isFinite(startedAtMs) && (now - startedAtMs) > stuckThresholdMs;
  let health = 'idle';
  if (isStuck) health = 'stuck';
  else if (state.busy) health = 'running';
  else if (state.consecutive_failures > 0) health = 'error';
  else if (state.last_success_at) health = 'healthy';
  return {
    name: state.name,
    interval_ms: Number(state.interval_ms || 0),
    scheduler_enabled: !!state.scheduler_enabled,
    busy: !!state.busy,
    stuck: isStuck,
    stuck_threshold_ms: stuckThresholdMs,
    health,
    current_origin: state.current_origin || null,
    current_activity_id: state.current_activity_id || null,
    current_started_at: toIsoStringOrNull(state.current_started_at),
    last_started_at: toIsoStringOrNull(state.last_started_at),
    last_finished_at: toIsoStringOrNull(state.last_finished_at),
    last_success_at: toIsoStringOrNull(state.last_success_at),
    last_manual_started_at: toIsoStringOrNull(state.last_manual_started_at),
    last_manual_success_at: toIsoStringOrNull(state.last_manual_success_at),
    last_error: state.last_error || null,
    last_error_at: toIsoStringOrNull(state.last_error_at),
    consecutive_failures: Number(state.consecutive_failures || 0),
    last_duration_ms: Number.isFinite(Number(state.last_duration_ms)) ? Number(state.last_duration_ms) : null,
    last_result: state.last_result || null
  };
}

function normalizeFeedbackTextForDedup(input = '') {
  const raw = String(input ?? '').trim();
  const normalizedSource = raw.startsWith(WITHDRAWN_FEEDBACK_PREFIX)
    ? raw.slice(WITHDRAWN_FEEDBACK_PREFIX.length)
    : raw;
  return Array.from(normalizedSource.toLowerCase())
    .filter(ch => /[a-z0-9\u4e00-\u9fff]/i.test(ch))
    .join('');
}

function isLowQualityFeedbackText(input = '') {
  const meaningful = normalizeFeedbackTextForDedup(input);
  if (meaningful.length < FEEDBACK_MIN_MEANINGFUL_CHARS) return true;
  if (/^(.)\1{2,}$/u.test(meaningful)) return true;
  return false;
}

function isWithdrawnFeedbackContent(input = '') {
  return String(input ?? '').startsWith(WITHDRAWN_FEEDBACK_PREFIX);
}

function makeWithdrawnFeedbackContent(input = '') {
  return `${WITHDRAWN_FEEDBACK_PREFIX}${String(input ?? '')}`;
}

function normalizeFeedbackDailyLimit(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return DEFAULT_FEEDBACK_DAILY_LIMIT;
  return Math.min(num, MAX_FEEDBACK_DAILY_LIMIT);
}

function parseFeedbackDailyLimitInput(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > MAX_FEEDBACK_DAILY_LIMIT) {
    const err = new Error(`Daily feedback limit must be an integer between 0 and ${MAX_FEEDBACK_DAILY_LIMIT}`);
    err.status = 400;
    throw err;
  }
  return num;
}

function normalizeArchiveAfterDays(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return DEFAULT_ARCHIVE_AFTER_DAYS;
  return Math.min(num, 365);
}

function parseArchiveAfterDaysInput(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 365) {
    const err = new Error('Archive after days must be an integer between 0 and 365');
    err.status = 400;
    throw err;
  }
  return num;
}

function normalizeArchiveDeletePrimary(value) {
  if (value === null || value === undefined) return DEFAULT_ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS;
  return !!value;
}

function resolveActivityArchivePolicy(activity = null) {
  return {
    after_days: normalizeArchiveAfterDays(activity?.archive_after_days),
    delete_primary_after_success: normalizeArchiveDeletePrimary(activity?.archive_delete_primary_after_success)
  };
}

function getBangkokDayRange(date = new Date()) {
  const shifted = new Date(date.getTime() + BANGKOK_UTC_OFFSET_MS);
  const startUtcMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ) - BANGKOK_UTC_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString()
  };
}

function formatAppTimestampCN(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}年${map.month}月${map.day}日${map.hour}时${map.minute}分${map.second}秒`;
}

function withUploadTimestampTitle(rawTitle, date = new Date(), maxLen = 140) {
  const base = String(rawTitle ?? '')
    .trim()
    .replace(/\s*[（(]\d{4}年\d{2}月\d{2}日\d{2}时(?:\d{2}分)?(?:\d{2}秒)?[）)]\s*$/u, '');
  const suffix = `（${formatAppTimestampCN(date)}）`;
  const maxBaseLen = Math.max(1, Number(maxLen) - suffix.length);
  return `${base.slice(0, maxBaseLen)}${suffix}`;
}

function normalizeInviteCode(input) {
  return String(input ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

function sanitizeActivity(activity) {
  if (!activity) return activity;
  const { teacher_password, ...safe } = activity;
  safe.roster_enabled = !!safe.roster_enabled;
  safe.pin_required = !!safe.pin_required;
  safe.feedback_daily_limit = normalizeFeedbackDailyLimit(safe.feedback_daily_limit);
  safe.archive_after_days = normalizeArchiveAfterDays(safe.archive_after_days);
  safe.archive_delete_primary_after_success = normalizeArchiveDeletePrimary(safe.archive_delete_primary_after_success);
  return safe;
}

function sanitizeMediaUrl(input) {
  try {
    const u = new URL(String(input ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeStoragePath(input) {
  const value = String(input ?? '').trim().replace(/^\/+/, '');
  if (!value) return null;
  if (!/^(uploads|videos|thumbs|manifests)\/[A-Za-z0-9._-]+$/.test(value)) return null;
  return value;
}

function storagePathFromPublicUrl(input) {
  const url = sanitizeMediaUrl(input);
  if (!url || !supabaseUrl) return null;
  try {
    const u = new URL(url);
    const expectedHost = new URL(supabaseUrl).host;
    if (u.host !== expectedHost) return null;
    const marker = '/storage/v1/object/public/submissions/';
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return null;
    return sanitizeStoragePath(decodeURIComponent(u.pathname.slice(idx + marker.length)));
  } catch {
    return null;
  }
}

function publicUrlForStoragePath(storagePath) {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) return null;
  const { data } = supabase.storage.from('submissions').getPublicUrl(safePath);
  return data?.publicUrl || null;
}

function isVideoFilePath(storagePath) {
  return /\.(mp4|mov|webm|ogg)$/i.test(String(storagePath || '').split('?')[0]);
}

function contentTypeForExtension(ext, fallback = 'application/octet-stream') {
  const normalized = String(ext || '').replace(/^\./, '').toLowerCase();
  const map = {
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    ogg: 'video/ogg',
    json: 'application/json'
  };
  return map[normalized] || fallback;
}

function createSidecarStoragePath(storagePath, folder, ext) {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) return null;
  const baseName = path.posix.basename(safePath).replace(/\.[^.]+$/, '');
  return `${folder}/${baseName}.${String(ext || '').replace(/^\./, '')}`;
}

function createMediaManifestStoragePath(submissionId) {
  const safeId = String(submissionId || '').trim();
  if (!safeId) return null;
  return `${MEDIA_MANIFEST_FOLDER}/${safeId}.json`;
}

function createTrashStoragePath(storagePath) {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) return null;
  const encodedPath = Buffer.from(safePath, 'utf8').toString('base64url');
  const baseName = path.posix.basename(safePath).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'object';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${STORAGE_TRASH_FOLDER}/${stamp}_${baseName}_${encodedPath}`;
}

async function quarantineStorageObject(storagePath, reason = 'safe-delete') {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) return false;
  if (safePath.startsWith(`${STORAGE_TRASH_FOLDER}/`)) {
    return deleteStorageObject(safePath, { permanent: true, reason: 'trash-purge' });
  }
  const trashPath = createTrashStoragePath(safePath);
  if (!trashPath) return false;
  const bucket = supabase.storage.from('submissions');
  let copied = false;
  try {
    const { error: copyError } = await bucket.copy(safePath, trashPath);
    if (copyError) throw copyError;
    copied = true;
  } catch (copyError) {
    try {
      const { data, error: downloadError } = await bucket.download(safePath);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await data.arrayBuffer());
      await uploadBufferToPrimaryStorage(trashPath, buffer, contentTypeForExtension(path.extname(safePath), 'application/octet-stream'));
      copied = true;
    } catch (fallbackError) {
      console.warn('Failed to quarantine storage object:', safePath, reason, fallbackError.message || fallbackError);
      return false;
    }
  }

  if (!copied) return false;
  const { error } = await supabase.storage.from('submissions').remove([safePath]);
  if (error) {
    console.warn('Failed to remove quarantined storage object:', safePath, error.message);
    return false;
  }
  return true;
}

async function deleteStorageObject(storagePath, options = {}) {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) return false;
  const permanent = !!options.permanent || !STORAGE_SAFE_DELETE;
  if (!permanent) {
    return quarantineStorageObject(safePath, options.reason || 'safe-delete');
  }
  const { error } = await supabase.storage.from('submissions').remove([safePath]);
  if (error) {
    console.warn('Failed to delete storage object:', safePath, error.message);
    return false;
  }
  return true;
}

const mediaManifestCache = new Map();
let googleDriveClientPromise = null;
let s3ArchiveClient = null;
const archiveSnapshotListCache = new Map();
const backgroundTaskState = {
  transcode: createTaskHealthState('transcode', TRANSCODE_LOOP_INTERVAL_MS, ASYNC_VIDEO_TRANSCODE),
  archive: createTaskHealthState('archive', ARCHIVE_LOOP_INTERVAL_MS, getArchiveProviderInfo().configured)
};

function submissionManifestNotFound(error) {
  const message = String(error?.message || error || '');
  return /not found|404|Object not found|The resource was not found/i.test(message);
}

function isStorageRlsError(error) {
  const message = String(error?.message || error || '');
  return /row-level security|violates row-level security policy|new row violates/i.test(message);
}

function cacheSubmissionMediaManifest(submissionId, manifest) {
  if (!submissionId) return;
  mediaManifestCache.set(String(submissionId), {
    expiresAt: Date.now() + 30 * 1000,
    manifest: manifest ? JSON.parse(JSON.stringify(manifest)) : null
  });
}

function getCachedSubmissionMediaManifest(submissionId) {
  const cached = mediaManifestCache.get(String(submissionId || ''));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    mediaManifestCache.delete(String(submissionId || ''));
    return null;
  }
  return cached.manifest ? JSON.parse(JSON.stringify(cached.manifest)) : null;
}

async function uploadLocalFileToPrimaryStorage(localPath, storagePath, contentType) {
  const stream = fs.createReadStream(localPath);
  const { error } = await supabase.storage.from('submissions').upload(storagePath, stream, {
    contentType,
    upsert: true,
    duplex: 'half'
  });
  if (error) throw error;
}

async function uploadBufferToPrimaryStorage(storagePath, buffer, contentType) {
  const { error } = await supabase.storage.from('submissions').upload(storagePath, buffer, {
    contentType,
    upsert: true
  });
  if (error) throw error;
}

async function replaceBufferInPrimaryStorage(storagePath, buffer, contentType) {
  const bucket = supabase.storage.from('submissions');
  let { error } = await bucket.update(storagePath, buffer, { contentType, upsert: true });
  if (!error) return;
  if (submissionManifestNotFound(error)) {
    ({ error } = await bucket.upload(storagePath, buffer, { contentType, upsert: true }));
    if (!error) return;
  }
  if (isStorageRlsError(error)) {
    await bucket.remove([storagePath]).catch(() => {});
    ({ error } = await bucket.upload(storagePath, buffer, { contentType, upsert: true }));
    if (!error) return;
  }
  throw error;
}

function buildDefaultSubmissionMediaManifest(submission = {}) {
  const mediaType = submission.media_type || (isVideoFilePath(submission.storage_path || submission.image_url) ? 'video' : 'image');
  return {
    version: 1,
    media_type: mediaType,
    thumbnail_path: null,
    thumbnail_url: null,
    poster_url: null,
    transcode_status: 'ready',
    transcode_attempts: 0,
    transcode_error: null,
    transcoded_at: null,
    original_media_size: Number(submission.media_size) || 0,
    compressed: false,
    saved_bytes: 0,
    saved_percent: 0,
    archive_tier: 'hot',
    archive_status: ARCHIVE_PROVIDER === 'none' ? 'disabled' : 'pending',
    archive_provider: null,
    archive_key: null,
    archive_url: null,
    archive_thumbnail_key: null,
    archive_thumbnail_url: null,
    archive_attempts: 0,
    archive_error: null,
    archived_at: null,
    updated_at: new Date().toISOString()
  };
}

function normalizeSubmissionMediaManifest(submission = {}, manifest = null) {
  const base = buildDefaultSubmissionMediaManifest(submission);
  const merged = {
    ...base,
    ...(manifest || {})
  };
  merged.media_type = merged.media_type || base.media_type;
  merged.thumbnail_path = sanitizeStoragePath(merged.thumbnail_path) || null;
  merged.thumbnail_url = sanitizeMediaUrl(merged.thumbnail_url) || publicUrlForStoragePath(merged.thumbnail_path) || null;
  merged.poster_url = sanitizeMediaUrl(merged.poster_url) || merged.thumbnail_url || null;
  merged.transcode_status = String(merged.transcode_status || base.transcode_status);
  merged.transcode_attempts = Number(merged.transcode_attempts || 0);
  merged.original_media_size = Number(merged.original_media_size || submission.media_size || 0);
  merged.saved_bytes = Number(merged.saved_bytes || 0);
  merged.saved_percent = Number(merged.saved_percent || 0);
  merged.archive_tier = String(merged.archive_tier || 'hot');
  merged.archive_status = String(merged.archive_status || (ARCHIVE_PROVIDER === 'none' ? 'disabled' : 'pending'));
  merged.archive_provider = merged.archive_provider ? String(merged.archive_provider) : null;
  merged.archive_key = merged.archive_key ? String(merged.archive_key) : null;
  merged.archive_url = sanitizeMediaUrl(merged.archive_url) || null;
  merged.archive_thumbnail_key = merged.archive_thumbnail_key ? String(merged.archive_thumbnail_key) : null;
  merged.archive_thumbnail_url = sanitizeMediaUrl(merged.archive_thumbnail_url) || null;
  merged.archive_attempts = Number(merged.archive_attempts || 0);
  merged.updated_at = merged.updated_at || new Date().toISOString();
  return merged;
}

function resolveSubmissionMediaUrl(submission = {}, manifest = null) {
  const normalized = normalizeSubmissionMediaManifest(submission, manifest);
  if (normalized.archive_tier === 'cold' && normalized.archive_url) return normalized.archive_url;
  return sanitizeMediaUrl(submission.image_url) || publicUrlForStoragePath(submission.storage_path) || '';
}

function resolveSubmissionThumbnailUrl(submission = {}, manifest = null) {
  const normalized = normalizeSubmissionMediaManifest(submission, manifest);
  if (normalized.archive_tier === 'cold' && normalized.archive_thumbnail_url) return normalized.archive_thumbnail_url;
  return normalized.thumbnail_url || resolveSubmissionMediaUrl(submission, normalized);
}

function mergeSubmissionWithManifest(submission = {}, manifest = null) {
  const normalized = normalizeSubmissionMediaManifest(submission, manifest);
  return {
    ...submission,
    image_url: resolveSubmissionMediaUrl(submission, normalized) || '',
    thumbnail_url: resolveSubmissionThumbnailUrl(submission, normalized) || '',
    poster_url: normalized.poster_url || resolveSubmissionThumbnailUrl(submission, normalized) || '',
    transcode_status: normalized.transcode_status,
    transcode_error: normalized.transcode_error || null,
    transcode_attempts: normalized.transcode_attempts,
    transcoded_at: normalized.transcoded_at || null,
    archive_tier: normalized.archive_tier,
    archive_status: normalized.archive_status,
    archive_provider: normalized.archive_provider,
    archive_key: normalized.archive_key,
    archive_url: normalized.archive_url,
    archive_thumbnail_key: normalized.archive_thumbnail_key,
    archive_thumbnail_url: normalized.archive_thumbnail_url,
    archived_at: normalized.archived_at || null,
    original_media_size: normalized.original_media_size,
    compression_saved_bytes: normalized.saved_bytes,
    compression_saved_percent: normalized.saved_percent,
    thumbnail_path: normalized.thumbnail_path
  };
}

async function readSubmissionMediaManifest(submissionId, { force = false } = {}) {
  if (!submissionId) return null;
  if (!force) {
    const cached = getCachedSubmissionMediaManifest(submissionId);
    if (cached) return cached;
  }
  const storagePath = createMediaManifestStoragePath(submissionId);
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from('submissions').download(storagePath);
  if (error) {
    if (submissionManifestNotFound(error)) return null;
    throw error;
  }
  const text = await data.text();
  const parsed = JSON.parse(text || '{}');
  cacheSubmissionMediaManifest(submissionId, parsed);
  return parsed;
}

async function writeSubmissionMediaManifest(submissionId, manifest) {
  const storagePath = createMediaManifestStoragePath(submissionId);
  if (!storagePath) return null;
  const normalized = normalizeSubmissionMediaManifest({}, manifest);
  normalized.updated_at = new Date().toISOString();
  const payload = Buffer.from(JSON.stringify(normalized, null, 2), 'utf8');
  await replaceBufferInPrimaryStorage(storagePath, payload, contentTypeForExtension('json'));
  cacheSubmissionMediaManifest(submissionId, normalized);
  return normalized;
}

async function deleteSubmissionMediaManifest(submissionId) {
  const storagePath = createMediaManifestStoragePath(submissionId);
  if (!storagePath) return false;
  mediaManifestCache.delete(String(submissionId || ''));
  return deleteStorageObject(storagePath);
}

async function enrichSubmissionMediaRows(rows = []) {
  return Promise.all((rows || []).map(async row => {
    const manifest = await readSubmissionMediaManifest(row.id).catch(() => null);
    return mergeSubmissionWithManifest(row, manifest);
  }));
}

async function downloadRemoteBuffer(sourceUrl) {
  if (!sourceUrl) throw new Error('Remote media url is unavailable');
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function streamBodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer());
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseGoogleDriveServiceAccount() {
  const inline = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!inline) return null;
  try {
    return JSON.parse(inline);
  } catch {
    return null;
  }
}

async function getGoogleDriveClient() {
  if (googleDriveClientPromise) return googleDriveClientPromise;
  googleDriveClientPromise = (async () => {
    const credentials = parseGoogleDriveServiceAccount();
    if (!credentials || !GOOGLE_DRIVE_FOLDER_ID) return null;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    return google.drive({ version: 'v3', auth });
  })();
  return googleDriveClientPromise;
}

function getS3ArchiveClient() {
  if (s3ArchiveClient) return s3ArchiveClient;
  if (!ARCHIVE_S3_BUCKET || !ARCHIVE_S3_ENDPOINT || !ARCHIVE_S3_ACCESS_KEY_ID || !ARCHIVE_S3_SECRET_ACCESS_KEY) {
    return null;
  }
  s3ArchiveClient = new S3Client({
    region: ARCHIVE_S3_REGION,
    endpoint: ARCHIVE_S3_ENDPOINT,
    forcePathStyle: ARCHIVE_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: ARCHIVE_S3_ACCESS_KEY_ID,
      secretAccessKey: ARCHIVE_S3_SECRET_ACCESS_KEY
    }
  });
  return s3ArchiveClient;
}

function getArchiveProviderInfo(policy = null) {
  const effectivePolicy = policy || resolveActivityArchivePolicy();
  if (ARCHIVE_PROVIDER === 'google-drive') {
    const credentials = parseGoogleDriveServiceAccount();
    return {
      name: 'google-drive',
      configured: !!(credentials && GOOGLE_DRIVE_FOLDER_ID),
      after_days: effectivePolicy.after_days,
      delete_primary_after_success: effectivePolicy.delete_primary_after_success,
      can_serve_public_url: GOOGLE_DRIVE_PUBLIC_LINKS
    };
  }
  if (ARCHIVE_PROVIDER === 's3') {
    return {
      name: 's3',
      configured: !!getS3ArchiveClient(),
      after_days: effectivePolicy.after_days,
      delete_primary_after_success: effectivePolicy.delete_primary_after_success,
      can_serve_public_url: !!ARCHIVE_S3_PUBLIC_BASE_URL
    };
  }
  return {
    name: 'none',
    configured: false,
    after_days: effectivePolicy.after_days,
    delete_primary_after_success: false,
    can_serve_public_url: false
  };
}

function buildArchiveObjectKey(submission, kind, ext) {
  const safeActivity = String(submission.activity_id || 'activity').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeSubmission = String(submission.id || 'submission').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeKind = String(kind || 'media').replace(/[^a-zA-Z0-9_-]/g, '');
  const suffix = String(ext || '').replace(/^\./, '').toLowerCase();
  return `classshow/${safeActivity}/${safeSubmission}/${safeKind}.${suffix}`;
}

function buildS3ArchivePublicUrl(key) {
  if (!ARCHIVE_S3_PUBLIC_BASE_URL) return null;
  return `${ARCHIVE_S3_PUBLIC_BASE_URL}/${String(key || '').replace(/^\/+/, '')}`;
}

function buildArchiveSnapshotPrefix(activityId) {
  const safeActivity = String(activityId || 'activity').replace(/[^a-zA-Z0-9_-]/g, '');
  return `classshow-backups/${safeActivity}/`;
}

function buildArchiveSnapshotObjectKey(activity = {}, snapshotId) {
  const prefix = buildArchiveSnapshotPrefix(activity.id || activity.activity_id || 'activity');
  const safeInviteCode = normalizeInviteCode(activity.invite_code || '') || 'activity';
  const safeSnapshotId = String(snapshotId || formatSnapshotStamp()).replace(/[^a-zA-Z0-9_-]/g, '');
  return `${prefix}${safeSnapshotId}_${safeInviteCode}.json`;
}

function buildSnapshotDownloadFilename(activity = {}, snapshotId = formatSnapshotStamp()) {
  const safeInviteCode = normalizeInviteCode(activity.invite_code || '') || 'activity';
  return `classshow_snapshot_${safeInviteCode}_${snapshotId}.json`;
}

function invalidateArchiveSnapshotListCache(activityId) {
  const safeActivity = String(activityId || '').trim();
  if (!safeActivity) {
    archiveSnapshotListCache.clear();
    return;
  }
  for (const key of archiveSnapshotListCache.keys()) {
    if (key.endsWith(`:${safeActivity}`)) archiveSnapshotListCache.delete(key);
  }
}

async function uploadLocalFileToArchiveObject(localPath, objectKey, contentType, provider = getArchiveProviderInfo()) {
  if (!provider.configured || !objectKey) return null;

  if (provider.name === 'google-drive') {
    const drive = await getGoogleDriveClient();
    if (!drive) return null;
    const { data } = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: String(objectKey).replace(/\//g, '__'),
        parents: [GOOGLE_DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: contentType,
        body: fs.createReadStream(localPath)
      },
      fields: 'id,name,webViewLink,createdTime,size'
    });
    if (GOOGLE_DRIVE_PUBLIC_LINKS) {
      await drive.permissions.create({
        fileId: data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
    }
    return {
      provider: 'google-drive',
      key: data.id,
      name: data.name || null,
      view_url: data.webViewLink || null,
      created_at: data.createdTime || new Date().toISOString(),
      size: Number(data.size || 0),
      url: GOOGLE_DRIVE_PUBLIC_LINKS ? `https://drive.google.com/uc?export=download&id=${data.id}` : null
    };
  }

  if (provider.name === 's3') {
    const client = getS3ArchiveClient();
    if (!client) return null;
    await client.send(new PutObjectCommand({
      Bucket: ARCHIVE_S3_BUCKET,
      Key: objectKey,
      Body: fs.createReadStream(localPath),
      ContentType: contentType
    }));
    return {
      provider: 's3',
      key: objectKey,
      name: path.posix.basename(objectKey),
      view_url: buildS3ArchivePublicUrl(objectKey),
      created_at: new Date().toISOString(),
      size: 0,
      url: buildS3ArchivePublicUrl(objectKey)
    };
  }

  return null;
}

async function uploadFileToArchive(localPath, submission, kind, ext, contentType, provider = getArchiveProviderInfo()) {
  if (!provider.configured) return null;
  const objectKey = buildArchiveObjectKey(submission, kind, ext);
  return uploadLocalFileToArchiveObject(localPath, objectKey, contentType, provider);
}

async function deleteArchiveObject(archiveKey, providerName, options = {}) {
  if (!archiveKey || !providerName) return false;
  const permanent = !!options.permanent || ARCHIVE_PERMANENT_DELETE;
  if (providerName === 'google-drive') {
    const drive = await getGoogleDriveClient();
    if (!drive) return false;
    if (permanent) {
      await drive.files.delete({ fileId: archiveKey, supportsAllDrives: true }).catch(() => {});
    } else {
      await drive.files.update({
        fileId: archiveKey,
        supportsAllDrives: true,
        requestBody: { trashed: true }
      }).catch(() => {});
    }
    return true;
  }
  if (providerName === 's3') {
    if (!permanent) return false;
    const client = getS3ArchiveClient();
    if (!client) return false;
    await client.send(new DeleteObjectCommand({ Bucket: ARCHIVE_S3_BUCKET, Key: archiveKey })).catch(() => {});
    return true;
  }
  return false;
}

async function downloadArchiveObjectToTemp({ archiveKey, archiveUrl, providerName, fallbackExt = 'bin' } = {}) {
  const ext = guessUploadExtension({ originalname: archiveKey || archiveUrl || `archive.${fallbackExt}` }, fallbackExt);
  const tempPath = createTempDerivedPath(ext);
  let buffer = null;

  if (archiveUrl) {
    buffer = await downloadRemoteBuffer(archiveUrl);
  } else if (providerName === 'google-drive' && archiveKey) {
    const drive = await getGoogleDriveClient();
    if (!drive) throw new Error('Google Drive archive client is not configured');
    const { data } = await drive.files.get(
      { fileId: archiveKey, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    buffer = Buffer.from(data);
  } else if (providerName === 's3' && archiveKey) {
    const client = getS3ArchiveClient();
    if (!client) throw new Error('S3 archive client is not configured');
    const result = await client.send(new GetObjectCommand({ Bucket: ARCHIVE_S3_BUCKET, Key: archiveKey }));
    buffer = await streamBodyToBuffer(result.Body);
  }

  if (!buffer?.length) throw new Error('Archive object is unavailable');
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

async function listArchiveSnapshots(activityId, { limit = 6, force = false, provider = getArchiveProviderInfo() } = {}) {
  const safeActivity = String(activityId || '').trim();
  if (!safeActivity) return { provider, items: [], cache_ttl_ms: OPS_SNAPSHOT_LIST_TTL_MS };
  const cacheKey = `${provider.name}:${safeActivity}`;
  const cached = archiveSnapshotListCache.get(cacheKey);
  if (!force && cached && cached.expires_at > Date.now()) {
    return cached.payload;
  }

  if (!provider.configured) {
    const payload = { provider, items: [], cache_ttl_ms: OPS_SNAPSHOT_LIST_TTL_MS };
    archiveSnapshotListCache.set(cacheKey, { expires_at: Date.now() + OPS_SNAPSHOT_LIST_TTL_MS, payload });
    return payload;
  }

  const prefix = buildArchiveSnapshotPrefix(safeActivity);
  let items = [];

  if (provider.name === 'google-drive') {
    const drive = await getGoogleDriveClient();
    if (!drive) throw new Error('Google Drive archive client is not configured');
    const namePrefix = prefix.replace(/\//g, '__');
    const { data } = await drive.files.list({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and name contains '${namePrefix}' and trashed = false`,
      orderBy: 'createdTime desc',
      pageSize: limit,
      fields: 'files(id,name,createdTime,size,webViewLink)'
    });
    items = (data.files || []).map(file => ({
      provider: 'google-drive',
      key: file.id,
      name: file.name || '',
      created_at: file.createdTime || null,
      size: Number(file.size || 0),
      url: GOOGLE_DRIVE_PUBLIC_LINKS ? `https://drive.google.com/uc?export=download&id=${file.id}` : null,
      view_url: file.webViewLink || null
    }));
  } else if (provider.name === 's3') {
    const client = getS3ArchiveClient();
    if (!client) throw new Error('S3 archive client is not configured');
    const { Contents = [] } = await client.send(new ListObjectsV2Command({
      Bucket: ARCHIVE_S3_BUCKET,
      Prefix: prefix,
      MaxKeys: limit
    }));
    items = Contents
      .slice()
      .sort((a, b) => new Date(b.LastModified || 0).getTime() - new Date(a.LastModified || 0).getTime())
      .slice(0, limit)
      .map(file => ({
        provider: 's3',
        key: file.Key || '',
        name: path.posix.basename(file.Key || ''),
        created_at: file.LastModified ? new Date(file.LastModified).toISOString() : null,
        size: Number(file.Size || 0),
        url: buildS3ArchivePublicUrl(file.Key || ''),
        view_url: buildS3ArchivePublicUrl(file.Key || '')
      }));
  }

  const payload = { provider, items, cache_ttl_ms: OPS_SNAPSHOT_LIST_TTL_MS };
  archiveSnapshotListCache.set(cacheKey, { expires_at: Date.now() + OPS_SNAPSHOT_LIST_TTL_MS, payload });
  return payload;
}

async function deleteSubmissionMedia(submission) {
  if (!submission) return false;
  const storagePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
  const manifest = submission.id ? await readSubmissionMediaManifest(submission.id).catch(() => null) : null;
  const normalized = normalizeSubmissionMediaManifest(submission, manifest);
  await Promise.all([
    deleteStorageObject(storagePath),
    deleteStorageObject(normalized.thumbnail_path),
    deleteSubmissionMediaManifest(submission.id),
    deleteArchiveObject(normalized.archive_key, normalized.archive_provider),
    deleteArchiveObject(normalized.archive_thumbnail_key, normalized.archive_provider)
  ]);
  return true;
}

async function ensureUploadOpen(activityId) {
  const { data, error } = await supabase.from('activities')
    .select('upload_open')
    .eq('id', activityId)
    .single();
  if (error) throw error;
  if (data && data.upload_open === false) {
    const err = new Error('Upload is closed by teacher');
    err.status = 403;
    throw err;
  }
}

async function clearSubmissionEngagement(submissionId) {
  const deletions = [
    supabase.from('ratings').delete().eq('submission_id', submissionId),
    supabase.from('views').delete().eq('submission_id', submissionId),
    supabase.from('comments').delete().eq('submission_id', submissionId)
  ];

  const results = await Promise.all(deletions);
  for (const result of results) {
    if (!result.error) continue;
    if (/comments|does not exist|schema cache/i.test(result.error.message || '')) continue;
    throw result.error;
  }
}

function parseAnonymousCodeNumber(code) {
  const match = String(code ?? '').trim().match(/^A(\d+)$/i);
  if (!match) return 0;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : 0;
}

async function generateNextAnonymousCode(activityId) {
  const { data, error } = await supabase.from('submissions')
    .select('anonymous_code')
    .eq('activity_id', activityId);
  if (error) throw error;
  const maxNum = (data || []).reduce((max, row) => {
    return Math.max(max, parseAnonymousCodeNumber(row.anonymous_code));
  }, 0);
  return `A${String(maxNum + 1).padStart(3, '0')}`;
}

async function fetchSubmissionWithMedia(id, fields) {
  const baseFields = fields || 'id,activity_id,user_id';
  let result = await supabase.from('submissions')
    .select(`${baseFields},image_url,storage_path`)
    .eq('id', id)
    .single();
  if (result.error && /storage_path/i.test(result.error.message || '')) {
    result = await supabase.from('submissions')
      .select(`${baseFields},image_url`)
      .eq('id', id)
      .single();
  }
  return result;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function makeStudentToken(activityId, userId) {
  return crypto.createHmac('sha256', EFFECTIVE_APP_SECRET).update(`${activityId}:${userId}`).digest('hex');
}

function makeLegacyStudentToken(userId) {
  return crypto.createHmac('sha256', EFFECTIVE_APP_SECRET).update(String(userId)).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function makeTeacherToken(activityId) {
  const expiresAt = Date.now() + TEACHER_TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${activityId}.${expiresAt}.${nonce}`;
  const sig = crypto.createHmac('sha256', EFFECTIVE_APP_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function parseTeacherToken(token) {
  try {
    const decoded = Buffer.from(String(token), 'base64url').toString();
    const [activityId, expiresAtRaw, nonce, sig] = decoded.split('.');
    if (!activityId || !expiresAtRaw || !nonce || !sig) return null;
    const payload = `${activityId}.${expiresAtRaw}.${nonce}`;
    const expectedSig = crypto.createHmac('sha256', EFFECTIVE_APP_SECRET).update(payload).digest('hex');
    if (!safeEqualHex(sig, expectedSig)) return null;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
    return { activityId };
  } catch {
    return null;
  }
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const normalized = String(pin ?? '').trim();
  if (!normalized) return null;
  const hash = crypto.createHmac('sha256', EFFECTIVE_APP_SECRET).update(`${salt}:${normalized}`).digest('hex');
  return { salt, hash };
}

function verifyPin(pin, salt, expectedHash) {
  if (!pin || !salt || !expectedHash) return false;
  const result = hashPin(pin, salt);
  return !!result && safeEqualHex(result.hash, expectedHash);
}

function normalizeRosterIdentity(input) {
  return String(input ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

function rosterNameMatches(inputName, rosterName) {
  const input = normalizeRosterIdentity(inputName);
  const expected = normalizeRosterIdentity(rosterName);
  return !!input && !!expected && input === expected;
}

function looksLikeStudentId(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /[0-9]/.test(text) && !/[\u4e00-\u9fff]/.test(text);
}

const ROSTER_ALIASES = {
  student_id: ['学号', '學生學號', '学生学号', 'student_id', 'studentid', 'id', 'stuid', '学籍号'],
  name: ['姓名', '名字', 'name', 'studentname'],
  class_name: ['班级', '班級', 'class_name', 'classname', 'class'],
  group_name: ['小组', '小組', '组别', '組別', 'group_name', 'group', 'team'],
  pin: ['pin', '口令', '密码', '密碼']
};

function normalizeRosterHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[_-]/g, '');
}

function findRosterHeaderIndexes(row) {
  const indexes = {};
  const normalizedAliases = Object.fromEntries(
    Object.entries(ROSTER_ALIASES).map(([field, aliases]) => [field, aliases.map(normalizeRosterHeader)])
  );
  row.forEach((cell, index) => {
    const header = normalizeRosterHeader(cell);
    if (header === '\u59d3\u540d') indexes.name = index;
    if (header === '\u5b66\u53f7' || header === '\u5b78\u865f') indexes.student_id = index;
    for (const [field, aliases] of Object.entries(normalizedAliases)) {
      if (aliases.includes(header)) indexes[field] = index;
    }
  });
  return indexes;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function normalizeRosterRows(rows, defaultClassName = '') {
  const table = rows
    .map(row => (Array.isArray(row) ? row : []).map(cell => String(cell ?? '').trim()))
    .filter(row => row.some(Boolean));
  if (table.length === 0) return [];

  const headerIndexes = findRosterHeaderIndexes(table[0]);
  const hasHeader = headerIndexes.name !== undefined && headerIndexes.student_id !== undefined;
  const dataRows = hasHeader ? table.slice(1) : table;

  return dataRows
    .map(row => {
      if (hasHeader) {
        return {
          name: row[headerIndexes.name] || '',
          student_id: row[headerIndexes.student_id] || '',
          class_name: headerIndexes.class_name !== undefined ? row[headerIndexes.class_name] || '' : '',
          group_name: headerIndexes.group_name !== undefined ? row[headerIndexes.group_name] || '' : '',
          pin: headerIndexes.pin !== undefined ? row[headerIndexes.pin] || '' : ''
        };
      }

      let name = row[0] || '';
      let student_id = row[1] || '';
      if (looksLikeStudentId(row[0]) && !looksLikeStudentId(row[1])) {
        student_id = row[0] || '';
        name = row[1] || '';
      }
      return { name, student_id, class_name: row[2] || '', group_name: row[3] || '', pin: row[4] || '' };
    })
    .map(row => ({
      name: String(row.name || '').trim(),
      student_id: String(row.student_id || '').trim(),
      class_name: String(row.class_name || defaultClassName || '').trim(),
      group_name: String(row.group_name || '').trim(),
      pin: String(row.pin || '').trim()
    }))
    .filter(row => row.name && row.student_id);
}

const ACTIVITY_PUBLIC_FIELDS = 'id,course_name,class_name,activity_name,description,invite_code,upload_open,voting_open,comments_open,show_live_ranking,roster_enabled,pin_required,feedback_daily_limit,archive_after_days,archive_delete_primary_after_success,created_at';
const ACTIVITY_LEGACY_FIELDS = 'id,course_name,class_name,activity_name,description,invite_code,upload_open,voting_open,comments_open,show_live_ranking,created_at';

async function fetchActivityById(activityId) {
  let result = await supabase.from('activities').select(ACTIVITY_PUBLIC_FIELDS).eq('id', activityId).single();
  if (result.error && /roster_enabled|pin_required|comments_open|feedback_daily_limit|archive_after_days|archive_delete_primary_after_success/i.test(result.error.message || '')) {
    result = await supabase.from('activities').select(ACTIVITY_LEGACY_FIELDS).eq('id', activityId).single();
  }
  if (result.data) result.data = sanitizeActivity(result.data);
  return result;
}

async function fetchActivityByCode(code) {
  const normalized = normalizeInviteCode(code);
  let result = await supabase.from('activities').select(ACTIVITY_PUBLIC_FIELDS).eq('invite_code', normalized).single();
  if (result.error && /roster_enabled|pin_required|comments_open|feedback_daily_limit|archive_after_days|archive_delete_primary_after_success/i.test(result.error.message || '')) {
    result = await supabase.from('activities').select(ACTIVITY_LEGACY_FIELDS).eq('invite_code', normalized).single();
  }
  if (result.data) result.data = sanitizeActivity(result.data);
  return result;
}

async function fetchActivityAccessPolicy(activityId) {
  let result = await supabase.from('activities').select('id,roster_enabled,pin_required').eq('id', activityId).single();
  if (result.error && /roster_enabled|pin_required/i.test(result.error.message || '')) {
    return { roster_enabled: false, pin_required: false };
  }
  if (result.error || !result.data) throw result.error || new Error('Activity not found');
  return {
    roster_enabled: !!result.data.roster_enabled,
    pin_required: !!result.data.pin_required
  };
}

async function validateRosterLogin(activityId, studentId, studentName, pin) {
  const policy = await fetchActivityAccessPolicy(activityId);
  if (!policy.roster_enabled && !policy.pin_required) return { required: false };

  const { data: roster, error } = await supabase.from('student_roster')
    .select('id,student_id,name,class_name,group_name,pin_hash,pin_salt,active')
    .eq('activity_id', activityId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) return { required: true, ok: false, status: 500, error: 'Student roster table is not ready. Run upgrade_v4.sql first.' };
  if (!roster || roster.active === false) return { required: true, ok: false, status: 403, error: 'Student is not on the class roster' };
  if (policy.roster_enabled && !rosterNameMatches(studentName, roster.name)) {
    return { required: true, ok: false, status: 403, error: 'Student name and ID do not match the class roster' };
  }
  if (policy.pin_required && !verifyPin(pin, roster.pin_salt, roster.pin_hash)) {
    return { required: true, ok: false, status: 403, error: 'Invalid student PIN' };
  }
  return { required: true, ok: true, roster };
}

async function validateStudentToken({ token, userId, activityId }) {
  if (!token || !userId || !activityId) {
    return { ok: false, status: 400, error: 'Missing user_id or activity_id' };
  }
  const modern = makeStudentToken(activityId, userId);
  const legacy = makeLegacyStudentToken(userId);
  const tokenValid = safeEqualHex(token, modern) || safeEqualHex(token, legacy);
  if (!tokenValid) return { ok: false, status: 403, error: 'Invalid token' };

  const { data: user, error } = await supabase.from('users')
    .select('id, activity_id')
    .eq('id', userId)
    .eq('activity_id', activityId)
    .single();
  if (error || !user) return { ok: false, status: 403, error: 'User/activity mismatch' };
  return { ok: true, user };
}

async function ensureTeacherCanAccessActivity(req, activityId) {
  if (!activityId) return { ok: false, status: 400, error: 'Missing activity_id' };

  if (req.teacherAuthMode === 'signed') {
    if (String(req.teacherActivityId) !== String(activityId)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true };
  }

  const { data: act } = await supabase.from('activities').select('teacher_password').eq('id', activityId).single();
  if (!act || act.teacher_password !== req.teacherPassword) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon';
  console.log(`Supabase connected using ${keyType} key.`);
} else {
  console.error('WARNING: Supabase credentials missing!');
}

// Multer for media upload (images + video, disk storage)
const tmpDir = path.join(__dirname, 'tmp_uploads');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const ALLOWED_MIME = ['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime'];
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB for ~1-min video
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持图片（JPG/PNG/WebP）和 MP4 视频'));
  }
});

const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filename = String(file.originalname || '').toLowerCase();
    if (filename.endsWith('.xlsx') || filename.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only .xlsx and .csv roster files are supported'));
  }
});

function guessUploadExtension(file, fallback = 'bin') {
  const fromName = String(path.extname(file?.originalname || '') || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (fromName) return fromName;
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  return fallback;
}

function createTempDerivedPath(ext) {
  const safeExt = String(ext || 'tmp').replace(/^\./, '');
  return path.join(tmpDir, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${safeExt}`);
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {}
}

async function cleanupTemporaryUploadFiles(maxAgeMs = TMP_UPLOAD_MAX_AGE_MS) {
  if (!fs.existsSync(tmpDir)) return { removed: 0 };
  const now = Date.now();
  const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
  let removed = 0;
  await Promise.all(entries.map(async entry => {
    if (!entry.isFile()) return;
    const fullPath = path.join(tmpDir, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      if ((now - stat.mtimeMs) >= maxAgeMs) {
        await safeUnlink(fullPath);
        removed += 1;
      }
    } catch {}
  }));
  return { removed };
}

function startTempUploadCleanupLoop() {
  cleanupTemporaryUploadFiles().catch(err => {
    console.warn('Initial tmp upload cleanup failed:', err.message);
  });
  setInterval(() => {
    cleanupTemporaryUploadFiles().catch(err => {
      console.warn('Periodic tmp upload cleanup failed:', err.message);
    });
  }, 60 * 60 * 1000).unref?.();
}

function getImageContentType() {
  return 'image/webp';
}

function getVideoContentType() {
  return 'video/mp4';
}

function getVideoThumbnailContentType() {
  return 'image/jpeg';
}

async function runFfmpeg(args) {
  if (!ffmpegStatic) {
    throw new Error('ffmpeg binary is unavailable');
  }
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function compressImageUpload(file) {
  const originalStat = await fs.promises.stat(file.path);
  const outputPath = createTempDerivedPath('webp');
  await sharp(file.path, { animated: false })
    .rotate()
    .resize({
      width: IMAGE_MAX_DIMENSION,
      height: IMAGE_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: IMAGE_WEBP_QUALITY })
    .toFile(outputPath);

  const outputStat = await fs.promises.stat(outputPath);
  const keepCompressed = outputStat.size <= (originalStat.size * 1.02);
  const thumbnailSource = keepCompressed ? outputPath : file.path;
  const thumbnailPath = createTempDerivedPath('webp');
  await sharp(thumbnailSource, { animated: false })
    .rotate()
    .resize({
      width: IMAGE_THUMB_MAX_DIMENSION,
      height: IMAGE_THUMB_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: IMAGE_THUMB_QUALITY })
    .toFile(thumbnailPath);
  const thumbnailStat = await fs.promises.stat(thumbnailPath);
  return {
    finalPath: keepCompressed ? outputPath : file.path,
    contentType: keepCompressed ? getImageContentType() : String(file.mimetype || 'image/jpeg'),
    storageExt: keepCompressed ? 'webp' : guessUploadExtension(file, 'jpg'),
    mediaType: 'image',
    size: keepCompressed ? outputStat.size : originalStat.size,
    originalSize: originalStat.size,
    optimized: keepCompressed,
    tempFiles: [file.path, outputPath, thumbnailPath],
    savedBytes: keepCompressed ? Math.max(0, originalStat.size - outputStat.size) : 0,
    asyncProcessing: false,
    transcodeStatus: 'ready',
    thumbnail: {
      finalPath: thumbnailPath,
      contentType: getImageContentType(),
      storageExt: 'webp',
      size: thumbnailStat.size
    }
  };
}

async function createVideoThumbnailFromUpload(filePath) {
  if (!ffmpegStatic) return null;
  const thumbnailPath = createTempDerivedPath('jpg');
  await runFfmpeg([
    '-y',
    '-threads', String(VIDEO_TRANSCODE_THREADS),
    '-ss', String(VIDEO_THUMB_CAPTURE_SECOND),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', `scale='min(iw,${VIDEO_THUMB_MAX_WIDTH})':-2:force_original_aspect_ratio=decrease`,
    '-q:v', '4',
    thumbnailPath
  ]);
  const thumbnailStat = await fs.promises.stat(thumbnailPath);
  return {
    finalPath: thumbnailPath,
    contentType: getVideoThumbnailContentType(),
    storageExt: 'jpg',
    size: thumbnailStat.size
  };
}

async function createImageThumbnailFromLocalFile(filePath) {
  const thumbnailPath = createTempDerivedPath('webp');
  await sharp(filePath, { animated: false })
    .rotate()
    .resize({
      width: IMAGE_THUMB_MAX_DIMENSION,
      height: IMAGE_THUMB_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: IMAGE_THUMB_QUALITY })
    .toFile(thumbnailPath);
  const thumbnailStat = await fs.promises.stat(thumbnailPath);
  return {
    finalPath: thumbnailPath,
    contentType: getImageContentType(),
    storageExt: 'webp',
    size: thumbnailStat.size
  };
}

async function generateThumbnailFromLocalFile(filePath, mediaType = 'image') {
  if (String(mediaType || 'image').toLowerCase() === 'video') {
    return createVideoThumbnailFromUpload(filePath);
  }
  return createImageThumbnailFromLocalFile(filePath);
}

async function compressVideoUpload(file) {
  const originalStat = await fs.promises.stat(file.path);
  const thumbnail = await createVideoThumbnailFromUpload(file.path).catch(() => null);
  const originalExt = guessUploadExtension(file, 'mp4');
  return {
    finalPath: file.path,
    contentType: String(file.mimetype || getVideoContentType()),
    storageExt: originalExt,
    mediaType: 'video',
    size: originalStat.size,
    originalSize: originalStat.size,
    optimized: false,
    tempFiles: [file.path, thumbnail?.finalPath].filter(Boolean),
    savedBytes: 0,
    asyncProcessing: ASYNC_VIDEO_TRANSCODE,
    transcodeStatus: ASYNC_VIDEO_TRANSCODE ? 'pending' : 'ready',
    thumbnail
  };
}

async function prepareUploadedMedia(file) {
  if (!file?.path) throw new Error('Upload file is missing');
  if (String(file.mimetype || '').startsWith('image/')) {
    return compressImageUpload(file);
  }
  if (String(file.mimetype || '').startsWith('video/')) {
    return compressVideoUpload(file);
  }
  const stat = await fs.promises.stat(file.path);
  return {
    finalPath: file.path,
    contentType: String(file.mimetype || 'application/octet-stream'),
    storageExt: guessUploadExtension(file),
    mediaType: 'file',
    size: stat.size,
    originalSize: stat.size,
    optimized: false,
    tempFiles: [file.path],
    savedBytes: 0
  };
}

async function downloadSubmissionMediaToTemp(submission) {
  const sourceUrl = resolveSubmissionMediaUrl(submission);
  const storagePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(sourceUrl) || storagePathFromPublicUrl(submission.image_url);
  const ext = guessUploadExtension({ originalname: storagePath || sourceUrl || submission.image_url }, 'mp4');
  const tempPath = createTempDerivedPath(ext);
  const buffer = await downloadRemoteBuffer(sourceUrl);
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

async function downloadStorageObjectToTemp(storagePath, fallbackExt = 'bin') {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) throw new Error('Storage path is unavailable');
  const ext = guessUploadExtension({ originalname: safePath }, fallbackExt);
  const tempPath = createTempDerivedPath(ext);
  const { data, error } = await supabase.storage.from('submissions').download(safePath);
  if (error) throw error;
  const buffer = Buffer.from(await data.arrayBuffer());
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

async function repairSubmissionThumbnail(submission) {
  const storagePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
  if (!storagePath) {
    const err = new Error('Submission source file path is unavailable');
    err.status = 400;
    throw err;
  }
  const manifest = normalizeSubmissionMediaManifest(submission, await readSubmissionMediaManifest(submission.id).catch(() => null));
  let sourceTempPath = null;
  let thumbnailTempPath = null;
  try {
    sourceTempPath = await downloadStorageObjectToTemp(storagePath, submission.media_type === 'video' ? 'mp4' : 'jpg');
    const thumbnail = await generateThumbnailFromLocalFile(sourceTempPath, submission.media_type || 'image');
    if (!thumbnail?.finalPath) {
      throw new Error('Thumbnail generation failed');
    }
    thumbnailTempPath = thumbnail.finalPath;
    const thumbnailPath = manifest.thumbnail_path
      || createSidecarStoragePath(storagePath, MEDIA_THUMBNAIL_FOLDER, thumbnail.storageExt);
    if (!thumbnailPath) {
      throw new Error('Thumbnail storage path could not be determined');
    }
    await uploadLocalFileToPrimaryStorage(thumbnail.finalPath, thumbnailPath, thumbnail.contentType);
    if (manifest.archive_thumbnail_key) {
      await deleteArchiveObject(manifest.archive_thumbnail_key, manifest.archive_provider);
    }
    const thumbnailUrl = publicUrlForStoragePath(thumbnailPath);
    const nextManifest = await writeSubmissionMediaManifest(submission.id, {
      ...manifest,
      thumbnail_path: thumbnailPath,
      thumbnail_url: thumbnailUrl,
      poster_url: thumbnailUrl,
      archive_status: ARCHIVE_PROVIDER === 'none' ? 'disabled' : 'pending',
      archive_provider: null,
      archive_key: null,
      archive_url: null,
      archive_thumbnail_key: null,
      archive_thumbnail_url: null,
      archive_error: null,
      archive_attempts: 0,
      archive_tier: 'primary'
    });
    return mergeSubmissionWithManifest(submission, nextManifest);
  } catch (error) {
    if (submissionManifestNotFound(error)) {
      const err = new Error('源文件已缺失，请先上传修复文件');
      err.status = 409;
      throw err;
    }
    throw error;
  } finally {
    await Promise.all([safeUnlink(sourceTempPath), safeUnlink(thumbnailTempPath)]);
  }
}

async function replaceTeacherSubmissionMedia(submission, file) {
  if (!file) {
    const err = new Error('Missing repair media file');
    err.status = 400;
    throw err;
  }
  const currentManifest = normalizeSubmissionMediaManifest(submission, await readSubmissionMediaManifest(submission.id).catch(() => null));
  const currentStoragePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
  const currentThumbnailPath = sanitizeStoragePath(currentManifest.thumbnail_path);
  const processed = await prepareUploadedMedia(file);
  const tempFiles = Array.isArray(processed.tempFiles) ? processed.tempFiles : [file.path];
  try {
    const folder = processed.mediaType === 'video' ? 'videos' : 'uploads';
    const nextStoragePath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${processed.storageExt}`;
    await uploadLocalFileToPrimaryStorage(processed.finalPath, nextStoragePath, processed.contentType);
    let nextThumbnailPath = null;
    let nextThumbnailUrl = null;
    if (processed.thumbnail?.finalPath) {
      nextThumbnailPath = createSidecarStoragePath(nextStoragePath, MEDIA_THUMBNAIL_FOLDER, processed.thumbnail.storageExt);
      if (nextThumbnailPath) {
        await uploadLocalFileToPrimaryStorage(processed.thumbnail.finalPath, nextThumbnailPath, processed.thumbnail.contentType);
        nextThumbnailUrl = publicUrlForStoragePath(nextThumbnailPath);
      }
    }

    const nextImageUrl = publicUrlForStoragePath(nextStoragePath);
    const nextMediaSize = Number(processed.size) || Number(submission.media_size) || 0;
    const nextMediaType = processed.mediaType || (isVideoFilePath(nextStoragePath) ? 'video' : 'image');
    await supabase.from('submissions').update({
      image_url: nextImageUrl,
      storage_path: nextStoragePath,
      media_type: nextMediaType,
      media_size: nextMediaSize
    }).eq('id', submission.id);

    if (currentStoragePath && currentStoragePath !== nextStoragePath) {
      await deleteStorageObject(currentStoragePath);
    }
    if (currentThumbnailPath && currentThumbnailPath !== nextThumbnailPath) {
      await deleteStorageObject(currentThumbnailPath);
    }
    if (currentManifest.archive_key) {
      await deleteArchiveObject(currentManifest.archive_key, currentManifest.archive_provider);
    }
    if (currentManifest.archive_thumbnail_key) {
      await deleteArchiveObject(currentManifest.archive_thumbnail_key, currentManifest.archive_provider);
    }

    const nextManifest = await writeSubmissionMediaManifest(submission.id, {
      ...currentManifest,
      thumbnail_path: nextThumbnailPath,
      thumbnail_url: nextThumbnailUrl,
      poster_url: nextThumbnailUrl,
      transcode_status: processed.transcodeStatus || 'ready',
      transcode_error: null,
      transcode_attempts: 0,
      original_media_size: Number(processed.originalSize || nextMediaSize || 0),
      compressed: !!processed.optimized,
      saved_bytes: Number(processed.savedBytes || 0),
      saved_percent: Number(processed.originalSize || 0) > 0
        ? Math.round((Number(processed.savedBytes || 0) / Number(processed.originalSize || 0)) * 100)
        : 0,
      archive_status: ARCHIVE_PROVIDER === 'none' ? 'disabled' : 'pending',
      archive_provider: null,
      archive_key: null,
      archive_url: null,
      archive_thumbnail_key: null,
      archive_thumbnail_url: null,
      archive_error: null,
      archive_attempts: 0,
      archive_tier: 'primary'
    });

    const refreshed = {
      ...submission,
      image_url: nextImageUrl,
      storage_path: nextStoragePath,
      media_type: nextMediaType,
      media_size: nextMediaSize
    };
    return mergeSubmissionWithManifest(refreshed, nextManifest);
  } finally {
    await Promise.all(tempFiles.map(filePath => safeUnlink(filePath)));
  }
}

async function restoreSubmissionFromArchive(submission) {
  const manifest = normalizeSubmissionMediaManifest(submission, await readSubmissionMediaManifest(submission.id).catch(() => null));
  if (!manifest.archive_key && !manifest.archive_url) {
    const err = new Error('No archive copy is available for this submission');
    err.status = 409;
    throw err;
  }

  const currentStoragePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
  const mediaExt = guessUploadExtension({
    originalname: currentStoragePath || manifest.archive_key || manifest.archive_url || submission.image_url
  }, submission.media_type === 'video' ? 'mp4' : 'jpg');
  const restoredStoragePath = currentStoragePath
    || `${submission.media_type === 'video' ? 'videos' : 'uploads'}/${Date.now()}_${Math.random().toString(36).slice(2)}.${mediaExt}`;
  const tempFiles = [];

  try {
    const mediaTempPath = await downloadArchiveObjectToTemp({
      archiveKey: manifest.archive_key,
      archiveUrl: manifest.archive_url,
      providerName: manifest.archive_provider,
      fallbackExt: mediaExt
    });
    tempFiles.push(mediaTempPath);
    await uploadLocalFileToPrimaryStorage(
      mediaTempPath,
      restoredStoragePath,
      contentTypeForExtension(mediaExt, submission.media_type === 'video' ? getVideoContentType() : getImageContentType())
    );

    let thumbnailPath = sanitizeStoragePath(manifest.thumbnail_path);
    let thumbnailUrl = manifest.thumbnail_url || null;
    if (manifest.archive_thumbnail_key || manifest.archive_thumbnail_url) {
      const thumbExt = guessUploadExtension({
        originalname: thumbnailPath || manifest.archive_thumbnail_key || manifest.archive_thumbnail_url
      }, 'webp');
      const thumbTempPath = await downloadArchiveObjectToTemp({
        archiveKey: manifest.archive_thumbnail_key,
        archiveUrl: manifest.archive_thumbnail_url,
        providerName: manifest.archive_provider,
        fallbackExt: thumbExt
      });
      tempFiles.push(thumbTempPath);
      thumbnailPath = thumbnailPath || createSidecarStoragePath(restoredStoragePath, MEDIA_THUMBNAIL_FOLDER, thumbExt);
      if (thumbnailPath) {
        await uploadLocalFileToPrimaryStorage(thumbTempPath, thumbnailPath, contentTypeForExtension(thumbExt, getImageContentType()));
        thumbnailUrl = publicUrlForStoragePath(thumbnailPath);
      }
    } else {
      const generated = await generateThumbnailFromLocalFile(mediaTempPath, submission.media_type || 'image').catch(() => null);
      if (generated?.finalPath) {
        tempFiles.push(generated.finalPath);
        thumbnailPath = thumbnailPath || createSidecarStoragePath(restoredStoragePath, MEDIA_THUMBNAIL_FOLDER, generated.storageExt);
        if (thumbnailPath) {
          await uploadLocalFileToPrimaryStorage(generated.finalPath, thumbnailPath, generated.contentType);
          thumbnailUrl = publicUrlForStoragePath(thumbnailPath);
        }
      }
    }

    const imageUrl = publicUrlForStoragePath(restoredStoragePath);
    await supabase.from('submissions').update({
      image_url: imageUrl,
      storage_path: restoredStoragePath
    }).eq('id', submission.id);

    const nextManifest = await writeSubmissionMediaManifest(submission.id, {
      ...manifest,
      thumbnail_path: thumbnailPath || null,
      thumbnail_url: thumbnailUrl || null,
      poster_url: thumbnailUrl || null,
      archive_status: 'mirrored',
      archive_tier: 'mirrored',
      archive_error: null,
      updated_at: new Date().toISOString()
    });

    return mergeSubmissionWithManifest({
      ...submission,
      image_url: imageUrl,
      storage_path: restoredStoragePath
    }, nextManifest);
  } finally {
    await Promise.all(tempFiles.map(filePath => safeUnlink(filePath)));
  }
}

async function transcodeSubmissionVideo(submission, manifest) {
  const inputPath = await downloadSubmissionMediaToTemp(submission);
  const outputPath = createTempDerivedPath('mp4');
  const tempFiles = [inputPath, outputPath];
  try {
    await runFfmpeg([
      '-y',
      '-threads', String(VIDEO_TRANSCODE_THREADS),
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', `scale='min(iw,${VIDEO_MAX_WIDTH})':-2:force_original_aspect_ratio=decrease`,
      '-c:v', 'libx264',
      '-preset', VIDEO_PRESET,
      '-crf', String(VIDEO_CRF),
      '-maxrate', VIDEO_MAXRATE,
      '-bufsize', '3200k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', VIDEO_AUDIO_BITRATE,
      '-ac', '2',
      outputPath
    ]);

    const originalSize = Number(manifest.original_media_size || submission.media_size || 0);
    const outputStat = await fs.promises.stat(outputPath);
    const currentStoragePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
    const useOptimized = outputStat.size < (originalSize * 0.98) || guessUploadExtension({ originalname: currentStoragePath }, 'mp4') !== 'mp4';
    let nextStoragePath = currentStoragePath;
    let nextImageUrl = sanitizeMediaUrl(submission.image_url) || publicUrlForStoragePath(currentStoragePath) || '';
    let nextMediaSize = Number(submission.media_size) || originalSize;

    if (useOptimized) {
      nextStoragePath = `videos/${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`;
      await uploadLocalFileToPrimaryStorage(outputPath, nextStoragePath, getVideoContentType());
      nextImageUrl = publicUrlForStoragePath(nextStoragePath) || nextImageUrl;
      nextMediaSize = outputStat.size;
      if (currentStoragePath && currentStoragePath !== nextStoragePath) {
        await deleteStorageObject(currentStoragePath);
      }
      await supabase.from('submissions').update({
        image_url: nextImageUrl,
        storage_path: nextStoragePath,
        media_size: nextMediaSize
      }).eq('id', submission.id);
    }

    return normalizeSubmissionMediaManifest(submission, {
      ...manifest,
      transcode_status: 'ready',
      transcode_error: null,
      transcode_attempts: Number(manifest.transcode_attempts || 0) + 1,
      transcoded_at: new Date().toISOString(),
      compressed: useOptimized,
      saved_bytes: useOptimized ? Math.max(0, originalSize - outputStat.size) : 0,
      saved_percent: useOptimized && originalSize > 0
        ? Math.round(((originalSize - outputStat.size) / originalSize) * 100)
        : 0
    });
  } finally {
    await Promise.all(tempFiles.map(filePath => safeUnlink(filePath)));
  }
}

let videoTranscodeLoopBusy = false;

async function processPendingVideoTranscodes({ activityId = null, limit = TRANSCODE_BATCH_SIZE, ignoreMinAge = false, source = 'loop' } = {}) {
  const taskState = backgroundTaskState.transcode;
  if (videoTranscodeLoopBusy) {
    const result = { processed: 0, queued: 0, skipped: true, reason: 'busy' };
    recordTaskRunSkip(taskState, result, { origin: source, activityId });
    return result;
  }
  videoTranscodeLoopBusy = true;
  recordTaskRunStart(taskState, { origin: source, activityId });
  let processed = 0;
  let queued = 0;
  try {
    let query = supabase.from('submissions')
      .select('id,activity_id,title,image_url,storage_path,media_type,media_size,upload_time,status')
      .eq('media_type', 'video')
      .order('upload_time', { ascending: true });
    if (activityId) query = query.eq('activity_id', activityId);
    const { data, error } = await query;
    if (error) throw error;
    for (const submission of (data || [])) {
      if (processed >= limit) break;
      if (!ignoreMinAge) {
        const uploadedAtMs = submission.upload_time ? new Date(submission.upload_time).getTime() : 0;
        if (uploadedAtMs && (Date.now() - uploadedAtMs) < TRANSCODE_MIN_AGE_MS) continue;
      }
      const manifest = normalizeSubmissionMediaManifest(submission, await readSubmissionMediaManifest(submission.id).catch(() => null));
      if (!['pending', 'retry'].includes(manifest.transcode_status)) continue;
      queued += 1;
      await writeSubmissionMediaManifest(submission.id, {
        ...manifest,
        transcode_status: 'processing',
        transcode_error: null
      });
      try {
        const nextManifest = await transcodeSubmissionVideo(submission, manifest);
        await writeSubmissionMediaManifest(submission.id, nextManifest);
      } catch (error) {
        const attempts = Number(manifest.transcode_attempts || 0) + 1;
        await writeSubmissionMediaManifest(submission.id, {
          ...manifest,
          transcode_status: attempts >= TRANSCODE_MAX_ATTEMPTS ? 'failed' : 'retry',
          transcode_attempts: attempts,
          transcode_error: String(error?.message || error || 'Transcode failed')
        });
      }
      processed += 1;
    }
    const result = { processed, queued, skipped: false };
    recordTaskRunSuccess(taskState, result, { origin: source, activityId });
    return result;
  } catch (error) {
    recordTaskRunFailure(taskState, error, { origin: source, activityId });
    throw error;
  } finally {
    videoTranscodeLoopBusy = false;
  }
}

function startVideoTranscodeLoop() {
  if (!ASYNC_VIDEO_TRANSCODE) return;
  processPendingVideoTranscodes({ source: 'loop' }).catch(err => {
    console.warn('Initial video transcode loop failed:', err.message);
  });
  setInterval(() => {
    processPendingVideoTranscodes({ source: 'loop' }).catch(err => {
      console.warn('Video transcode loop failed:', err.message);
    });
  }, TRANSCODE_LOOP_INTERVAL_MS).unref?.();
}

function getArchiveCutoffIso(afterDays = DEFAULT_ARCHIVE_AFTER_DAYS) {
  if (afterDays <= 0) return null;
  return new Date(Date.now() - (afterDays * 24 * 60 * 60 * 1000)).toISOString();
}

let archiveLoopBusy = false;

async function processArchiveQueue({ activityId = null, limit = ARCHIVE_BATCH_SIZE, source = 'loop' } = {}) {
  const baseProvider = getArchiveProviderInfo();
  const taskState = backgroundTaskState.archive;
  if (!baseProvider.configured) {
    const result = { processed: 0, queued: 0, skipped: true, reason: 'provider-not-configured', provider: baseProvider };
    recordTaskRunSkip(taskState, result, { origin: source, activityId });
    return result;
  }
  if (archiveLoopBusy) {
    const result = { processed: 0, queued: 0, skipped: true, reason: 'busy', provider: baseProvider };
    recordTaskRunSkip(taskState, result, { origin: source, activityId });
    return result;
  }
  archiveLoopBusy = true;
  recordTaskRunStart(taskState, { origin: source, activityId });
  let processed = 0;
  let queued = 0;
  try {
    let query = supabase.from('submissions')
      .select('id,activity_id,title,image_url,storage_path,media_type,media_size,upload_time,status')
      .order('upload_time', { ascending: true });
    if (activityId) query = query.eq('activity_id', activityId);
    const { data, error } = await query;
    if (error) throw error;

    const activityIds = [...new Set((data || []).map(item => String(item.activity_id || '')).filter(Boolean))];
    let activityConfigMap = new Map();
    if (activityIds.length) {
      let activityConfigResult = await supabase.from('activities')
        .select('id,archive_after_days,archive_delete_primary_after_success')
        .in('id', activityIds);
      if (activityConfigResult.error && /archive_after_days|archive_delete_primary_after_success/i.test(activityConfigResult.error.message || '')) {
        activityConfigResult = await supabase.from('activities').select('id').in('id', activityIds);
      }
      if (activityConfigResult.error) throw activityConfigResult.error;
      activityConfigMap = new Map((activityConfigResult.data || []).map(row => [String(row.id), row]));
    }

    const activityPolicy = activityId ? resolveActivityArchivePolicy(activityConfigMap.get(String(activityId))) : null;
    if (activityPolicy && !getArchiveCutoffIso(activityPolicy.after_days)) {
      const result = { processed: 0, queued: 0, skipped: true, reason: 'archive-disabled', provider: getArchiveProviderInfo(activityPolicy) };
      recordTaskRunSuccess(taskState, result, { origin: source, activityId });
      return result;
    }

    for (const submission of (data || [])) {
      if (processed >= limit) break;
      const policy = resolveActivityArchivePolicy(activityConfigMap.get(String(submission.activity_id || '')));
      const cutoffIso = getArchiveCutoffIso(policy.after_days);
      if (!cutoffIso) continue;
      if (new Date(submission.upload_time).getTime() > new Date(cutoffIso).getTime()) continue;
      const provider = getArchiveProviderInfo(policy);
      const manifest = normalizeSubmissionMediaManifest(submission, await readSubmissionMediaManifest(submission.id).catch(() => null));
      if (['mirrored', 'cold'].includes(manifest.archive_status)) continue;
      if (manifest.archive_status === 'processing') continue;
      queued += 1;

      const mediaStoragePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
      if (!mediaStoragePath) continue;
      const currentThumbnailPath = sanitizeStoragePath(manifest.thumbnail_path);
      await writeSubmissionMediaManifest(submission.id, {
        ...manifest,
        archive_status: 'processing',
        archive_error: null
      });

      const tempFiles = [];
      try {
        const mediaTempPath = await downloadSubmissionMediaToTemp(submission);
        tempFiles.push(mediaTempPath);
        const mediaExt = guessUploadExtension({ originalname: mediaStoragePath }, submission.media_type === 'video' ? 'mp4' : 'jpg');
        const mediaArchive = await uploadFileToArchive(mediaTempPath, submission, 'media', mediaExt, contentTypeForExtension(mediaExt, submission.media_type === 'video' ? getVideoContentType() : getImageContentType()), provider);

        let thumbArchive = null;
        if (currentThumbnailPath) {
          const thumbTempPath = await downloadSubmissionMediaToTemp({
            ...submission,
            image_url: publicUrlForStoragePath(currentThumbnailPath),
            storage_path: currentThumbnailPath
          });
          tempFiles.push(thumbTempPath);
          const thumbExt = guessUploadExtension({ originalname: currentThumbnailPath }, 'webp');
          thumbArchive = await uploadFileToArchive(thumbTempPath, submission, 'thumb', thumbExt, contentTypeForExtension(thumbExt, getImageContentType()), provider);
        }

        const shouldPromoteToCold = provider.delete_primary_after_success && provider.can_serve_public_url && mediaArchive?.url;
        if (shouldPromoteToCold && mediaStoragePath) {
          await deleteStorageObject(mediaStoragePath, { permanent: true, reason: 'cold-archive-primary-release' });
          if (currentThumbnailPath) {
            await deleteStorageObject(currentThumbnailPath, { permanent: true, reason: 'cold-archive-primary-release' });
          }
        }

        await writeSubmissionMediaManifest(submission.id, {
          ...manifest,
          archive_status: shouldPromoteToCold ? 'cold' : 'mirrored',
          archive_tier: shouldPromoteToCold ? 'cold' : 'mirrored',
          archive_provider: mediaArchive?.provider || provider.name,
          archive_key: mediaArchive?.key || null,
          archive_url: mediaArchive?.url || null,
          archive_thumbnail_key: thumbArchive?.key || null,
          archive_thumbnail_url: thumbArchive?.url || null,
          archive_attempts: Number(manifest.archive_attempts || 0) + 1,
          archive_error: null,
          archived_at: new Date().toISOString()
        });
      } catch (error) {
        const attempts = Number(manifest.archive_attempts || 0) + 1;
        await writeSubmissionMediaManifest(submission.id, {
          ...manifest,
          archive_status: attempts >= ARCHIVE_MAX_ATTEMPTS ? 'failed' : 'pending',
          archive_attempts: attempts,
          archive_error: String(error?.message || error || 'Archive failed')
        });
      } finally {
        await Promise.all(tempFiles.map(filePath => safeUnlink(filePath)));
      }
      processed += 1;
    }

    const result = { processed, queued, skipped: false, provider: activityPolicy ? getArchiveProviderInfo(activityPolicy) : baseProvider };
    recordTaskRunSuccess(taskState, result, { origin: source, activityId });
    return result;
  } catch (error) {
    recordTaskRunFailure(taskState, error, { origin: source, activityId });
    throw error;
  } finally {
    archiveLoopBusy = false;
  }
}

function startArchiveLoop() {
  const provider = getArchiveProviderInfo();
  if (!provider.configured) return;
  processArchiveQueue({ source: 'loop' }).catch(err => {
    console.warn('Initial archive loop failed:', err.message);
  });
  setInterval(() => {
    processArchiveQueue({ source: 'loop' }).catch(err => {
      console.warn('Archive loop failed:', err.message);
    });
  }, ARCHIVE_LOOP_INTERVAL_MS).unref?.();
}

async function listStorageFolder(folder) {
  const files = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from('submissions').list(folder, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;
    files.push(...data.map(item => ({
      ...item,
      folder,
      path: `${folder}/${item.name}`
    })));
    if (data.length < 100) break;
    offset += data.length;
  }
  return files;
}

async function listTrackedStorageFiles() {
  const folders = ['uploads', 'videos', MEDIA_THUMBNAIL_FOLDER, MEDIA_MANIFEST_FOLDER, STORAGE_TRASH_FOLDER];
  const results = await Promise.all(folders.map(folder => listStorageFolder(folder).catch(() => [])));
  return results.flat();
}

async function buildStorageSummary(activityId) {
  const [{ data: activitySubs, error }, { data: allSubs, error: allSubsError }] = await Promise.all([
    supabase.from('submissions')
    .select('id,title,upload_time,storage_path,image_url,media_type,media_size')
      .eq('activity_id', activityId),
    supabase.from('submissions')
      .select('id,storage_path,image_url,media_type')
  ]);
  if (error) throw error;
  if (allSubsError) throw allSubsError;

  const activityRows = await Promise.all((activitySubs || []).map(async row => {
    const manifest = normalizeSubmissionMediaManifest(row, await readSubmissionMediaManifest(row.id).catch(() => null));
    const storagePath = sanitizeStoragePath(row.storage_path) || storagePathFromPublicUrl(row.image_url);
    const size = Number(row.media_size) || 0;
    return {
      id: row.id,
      title: row.title,
      upload_time: row.upload_time,
      storage_path: storagePath,
      media_type: row.media_type || (isVideoFilePath(storagePath) ? 'video' : 'image'),
      media_size: size,
      thumbnail_path: manifest.thumbnail_path,
      manifest_path: createMediaManifestStoragePath(row.id)
    };
  }));

  const referenced = activityRows.filter(row => row.storage_path);

  const allRows = await Promise.all((allSubs || []).map(async row => {
    const manifest = normalizeSubmissionMediaManifest(row, await readSubmissionMediaManifest(row.id).catch(() => null));
    return { ...row, thumbnail_path: manifest.thumbnail_path };
  }));

  const globallyReferencedPathSet = new Set(
    allRows.flatMap(row => {
      const storagePath = sanitizeStoragePath(row.storage_path) || storagePathFromPublicUrl(row.image_url);
      const derivedThumbPath = storagePath
        ? createSidecarStoragePath(storagePath, MEDIA_THUMBNAIL_FOLDER, (row.media_type || (isVideoFilePath(storagePath) ? 'video' : 'image')) === 'video' ? 'jpg' : 'webp')
        : null;
      return [
        storagePath,
        derivedThumbPath,
        sanitizeStoragePath(row.thumbnail_path),
        createMediaManifestStoragePath(row.id)
      ].filter(Boolean);
    })
  );
  const storageFiles = await listTrackedStorageFiles();
  const trackedPathSet = new Set(storageFiles.map(file => file.path).filter(Boolean));
  const trashFiles = storageFiles.filter(file => String(file.path || '').startsWith(`${STORAGE_TRASH_FOLDER}/`));
  const now = Date.now();
  const referencedBytes = referenced.reduce((sum, row) => sum + (row.media_size || 0), 0);
  const storageBytes = storageFiles.reduce((sum, row) => sum + Number(row.metadata?.size || 0), 0);
  const thumbCount = activityRows.filter(row => row.thumbnail_path).length;
  const manifestCount = activityRows.filter(row => row.manifest_path).length;
  const thumbBytes = storageFiles
    .filter(file => activityRows.some(row => row.thumbnail_path === file.path))
    .reduce((sum, file) => sum + Number(file.metadata?.size || 0), 0);
  const manifestBytes = storageFiles
    .filter(file => activityRows.some(row => row.manifest_path === file.path))
    .reduce((sum, file) => sum + Number(file.metadata?.size || 0), 0);

  const orphanFiles = storageFiles.filter(file => {
    if (String(file.path || '').startsWith(`${STORAGE_TRASH_FOLDER}/`)) return false;
    if (globallyReferencedPathSet.has(file.path)) return false;
    const createdMs = new Date(file.created_at || file.updated_at || 0).getTime();
    if (!Number.isFinite(createdMs) || createdMs <= 0) return false;
    return (now - createdMs) >= STORAGE_ORPHAN_MIN_AGE_MS;
  }).map(file => ({
    path: file.path,
    name: file.name,
    size: Number(file.metadata?.size || 0),
    created_at: file.created_at || file.updated_at || null
  }));

  const imageCount = referenced.filter(row => row.media_type !== 'video').length;
  const videoCount = referenced.filter(row => row.media_type === 'video').length;
  const averageSize = referenced.length ? Math.round(referencedBytes / referenced.length) : 0;
  const largestItems = referenced
    .slice()
    .sort((a, b) => (b.media_size || 0) - (a.media_size || 0))
    .slice(0, 5);
  const recentUploads7d = activityRows.filter(row => {
    const uploadedMs = new Date(row.upload_time || 0).getTime();
    return Number.isFinite(uploadedMs) && uploadedMs > 0 && (now - uploadedMs) <= 7 * 24 * 60 * 60 * 1000;
  });
  const recentReferencedBytes7d = recentUploads7d.reduce((sum, row) => sum + Number(row.media_size || 0), 0);
  const overheadRatio = referencedBytes > 0 ? Math.max(1, storageBytes / referencedBytes) : 1;
  const dailyGrowthBytes = recentReferencedBytes7d > 0
    ? Math.round((recentReferencedBytes7d * overheadRatio) / 7)
    : 0;
  const quotaBytes = STORAGE_WARNING_LIMIT_BYTES;
  const usagePercent = quotaBytes > 0 ? Math.min((storageBytes / quotaBytes) * 100, 999) : 0;
  const remainingBytes = Math.max(quotaBytes - storageBytes, 0);
  const estimatedDaysToLimit = dailyGrowthBytes > 0 ? Math.max(0, Math.floor(remainingBytes / dailyGrowthBytes)) : null;
  let warningLevel = 'healthy';
  let warningTitle = '空间健康';
  let warningMessage = '当前空间占用较低，继续保持压缩上传和定期清理即可。';
  if (usagePercent >= 90 || remainingBytes <= 128 * 1024 * 1024 || (estimatedDaysToLimit !== null && estimatedDaysToLimit <= 7)) {
    warningLevel = 'critical';
    warningTitle = '空间即将打满';
    warningMessage = `按当前用量与近 7 天增长速度估算，剩余约 ${formatStorageBytes(remainingBytes)}，建议立即归档并尽快释放主存。`;
  } else if (usagePercent >= 75 || remainingBytes <= 256 * 1024 * 1024 || (estimatedDaysToLimit !== null && estimatedDaysToLimit <= 21)) {
    warningLevel = 'warning';
    warningTitle = '空间进入预警区';
    warningMessage = `当前桶总量已接近配额上限，建议把归档阈值调低到 7 天左右，并优先隔离孤儿文件后再评估空间。`;
  } else if (usagePercent >= 60 || (estimatedDaysToLimit !== null && estimatedDaysToLimit <= 45)) {
    warningLevel = 'attention';
    warningTitle = '建议提前归档';
    warningMessage = `当前仍可稳定使用，但如果课堂上传继续保持最近 7 天速度，建议尽早调整归档策略。`;
  }

  const summary = {
    total_files: storageFiles.length,
    total_bytes: storageBytes,
    referenced_files: referenced.length,
    referenced_bytes: referencedBytes,
    image_count: imageCount,
    video_count: videoCount,
    thumbnail_count: thumbCount,
    thumbnail_bytes: thumbBytes,
    manifest_count: manifestCount,
    manifest_bytes: manifestBytes,
    average_file_bytes: averageSize,
    orphan_files: orphanFiles,
    orphan_count: orphanFiles.length,
    orphan_bytes: orphanFiles.reduce((sum, file) => sum + file.size, 0),
    trash_count: trashFiles.length,
    trash_bytes: trashFiles.reduce((sum, file) => sum + Number(file.metadata?.size || 0), 0),
    largest_items: largestItems,
    quota_bytes: quotaBytes,
    usage_percent: Math.round(usagePercent * 10) / 10,
    remaining_bytes: remainingBytes,
    recent_upload_count_7d: recentUploads7d.length,
    recent_upload_bytes_7d: recentReferencedBytes7d,
    estimated_growth_bytes_per_day: dailyGrowthBytes,
    estimated_days_to_limit: estimatedDaysToLimit,
    warning: {
      level: warningLevel,
      title: warningTitle,
      message: warningMessage
    }
  };
  Object.defineProperty(summary, '_tracked_path_set', {
    value: trackedPathSet,
    enumerable: false,
    configurable: false
  });
  return summary;
}

function buildMissingMediaReport(submissions = [], storageSummary = {}) {
  const trackedPathSet = storageSummary?._tracked_path_set instanceof Set
    ? storageSummary._tracked_path_set
    : new Set();
  const items = [];
  let sourceMissingCount = 0;
  let thumbnailMissingCount = 0;
  const now = Date.now();
  const graceWindowMs = 2 * 60 * 1000;

  for (const submission of submissions || []) {
    const mediaPath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
    const thumbnailPath = sanitizeStoragePath(submission.thumbnail_path);
    const mediaType = submission.media_type || (isVideoFilePath(mediaPath || submission.image_url) ? 'video' : 'image');
    const sourceMissing = !!mediaPath && !trackedPathSet.has(mediaPath);
    const thumbnailExpected = mediaType === 'video' || !!thumbnailPath;
    const thumbnailMissing = thumbnailExpected && (
      !thumbnailPath || !trackedPathSet.has(thumbnailPath)
    );
    const uploadAt = submission.upload_time ? new Date(submission.upload_time).getTime() : 0;
    const withinGraceWindow = uploadAt > 0 && (now - uploadAt) < graceWindowMs;

    if (!sourceMissing && !thumbnailMissing) continue;
    if (withinGraceWindow) continue;

    if (sourceMissing) sourceMissingCount += 1;
    if (thumbnailMissing) thumbnailMissingCount += 1;

    const issueCodes = [];
    const issueLabels = [];
    if (sourceMissing) {
      issueCodes.push('source_missing');
      issueLabels.push('源文件缺失');
    }
    if (thumbnailMissing) {
      issueCodes.push('thumbnail_missing');
      issueLabels.push('缩略图缺失');
    }

    const hasArchiveCopy = !!(submission.archive_url || submission.archive_key);
    items.push({
      id: submission.id,
      title: submission.title || '未命名作品',
      upload_time: submission.upload_time || null,
      media_type: mediaType,
      storage_path: mediaPath || '',
      thumbnail_path: thumbnailPath || '',
      issue_codes: issueCodes,
      issue_labels: issueLabels,
      source_missing: sourceMissing,
      thumbnail_missing: thumbnailMissing,
      can_rebuild_thumbnail: !sourceMissing,
      has_archive_copy: hasArchiveCopy,
      can_restore_archive: sourceMissing && hasArchiveCopy,
      archive_status: submission.archive_status || null,
      archive_tier: submission.archive_tier || null,
      users: submission.users || {}
    });
  }

  items.sort((a, b) => {
    if (Number(b.source_missing) !== Number(a.source_missing)) {
      return Number(b.source_missing) - Number(a.source_missing);
    }
    if (Number(b.thumbnail_missing) !== Number(a.thumbnail_missing)) {
      return Number(b.thumbnail_missing) - Number(a.thumbnail_missing);
    }
    return new Date(b.upload_time || 0).getTime() - new Date(a.upload_time || 0).getTime();
  });

  return {
    total_count: items.length,
    source_missing_count: sourceMissingCount,
    thumbnail_missing_count: thumbnailMissingCount,
    items
  };
}

async function buildActivitySnapshot(activityId) {
  let [
    activityResult,
    usersResult,
    rosterResult,
    submissionsResult,
    ratingsResult,
    commentsResult,
    viewsResult,
    feedbackLikesResult,
    storageSummary
  ] = await Promise.all([
    fetchActivityById(activityId),
    supabase.from('users')
      .select('id,activity_id,name,student_id,class_name,group_name,created_at')
      .eq('activity_id', activityId)
      .order('student_id', { ascending: true }),
    supabase.from('student_roster')
      .select('id,activity_id,student_id,name,class_name,group_name,active,feedback_muted,created_at,updated_at')
      .eq('activity_id', activityId)
      .order('student_id', { ascending: true }),
    supabase.from('submissions')
      .select('id,activity_id,user_id,title,description,image_url,storage_path,media_type,media_size,upload_time,last_modified_time,view_count,rating_count,average_rating,composite_score,anonymous_code,is_teacher_selected,is_pinned,status')
      .eq('activity_id', activityId)
      .order('upload_time', { ascending: true }),
    supabase.from('ratings')
      .select('id,activity_id,submission_id,rater_user_id,score,created_at,updated_at')
      .eq('activity_id', activityId)
      .order('created_at', { ascending: true }),
    supabase.from('comments')
      .select('id,activity_id,submission_id,user_id,content,is_anonymous,created_at')
      .eq('activity_id', activityId)
      .order('created_at', { ascending: true }),
    supabase.from('views')
      .select('id,activity_id,submission_id,viewer_user_id,is_valid,viewed_at')
      .eq('activity_id', activityId)
      .order('viewed_at', { ascending: true }),
    supabase.from('activity_feedback_likes')
      .select('id,activity_id,feedback_id,user_id,created_at')
      .eq('activity_id', activityId)
      .order('created_at', { ascending: true }),
    buildStorageSummary(activityId)
  ]);

  if (activityResult.error) throw activityResult.error;
  if (usersResult.error) throw usersResult.error;
  if (submissionsResult.error) throw submissionsResult.error;

  const submissionIds = (submissionsResult.data || []).map(item => item.id).filter(Boolean);

  if (ratingsResult.error && /activity_id/i.test(ratingsResult.error.message || '') && submissionIds.length) {
    ratingsResult = await supabase.from('ratings')
      .select('id,submission_id,rater_user_id,score,created_at,updated_at')
      .in('submission_id', submissionIds)
      .order('created_at', { ascending: true });
  }
  if (commentsResult.error && /activity_id/i.test(commentsResult.error.message || '')) {
    const userIds = (usersResult.data || []).map(item => item.id).filter(Boolean);
    const [workCommentsResult, feedbackCommentsResult] = await Promise.all([
      submissionIds.length
        ? supabase.from('comments')
          .select('id,submission_id,user_id,content,is_anonymous,created_at')
          .in('submission_id', submissionIds)
          .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? supabase.from('comments')
          .select('id,submission_id,user_id,content,is_anonymous,created_at')
          .is('submission_id', null)
          .in('user_id', userIds)
          .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    commentsResult = {
      data: [...(workCommentsResult.data || []), ...(feedbackCommentsResult.data || [])]
        .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()),
      error: workCommentsResult.error || feedbackCommentsResult.error || null
    };
  }
  if (viewsResult.error && /activity_id/i.test(viewsResult.error.message || '') && submissionIds.length) {
    viewsResult = await supabase.from('views')
      .select('id,submission_id,viewer_user_id,is_valid,viewed_at')
      .in('submission_id', submissionIds)
      .order('viewed_at', { ascending: true });
  }
  if (feedbackLikesResult.error && /activity_id/i.test(feedbackLikesResult.error.message || '') && submissionIds.length && commentsResult.data?.length) {
    const feedbackIds = commentsResult.data
      .filter(item => !item.submission_id)
      .map(item => item.id)
      .filter(Boolean);
    if (feedbackIds.length) {
      feedbackLikesResult = await supabase.from('activity_feedback_likes')
        .select('id,feedback_id,user_id,created_at')
        .in('feedback_id', feedbackIds)
        .order('created_at', { ascending: true });
    }
  }

  if (ratingsResult.error) throw ratingsResult.error;
  if (viewsResult.error) throw viewsResult.error;
  if (commentsResult.error && !/comments|does not exist|schema cache/i.test(commentsResult.error.message || '')) {
    throw commentsResult.error;
  }

  const activity = sanitizeActivity(activityResult.data || {});
  const archivePolicy = resolveActivityArchivePolicy(activity);
  const archiveProvider = getArchiveProviderInfo(archivePolicy);

  const roster = rosterResult.error ? [] : (rosterResult.data || []);
  const rosterReady = !rosterResult.error;
  const users = usersResult.data || [];
  const submissions = await enrichSubmissionMediaRows((submissionsResult.data || []).map(item => ({
    ...item,
    media_size: Number(item.media_size || 0),
    view_count: Number(item.view_count || 0),
    rating_count: Number(item.rating_count || 0),
    average_rating: Number(item.average_rating || 0),
    composite_score: Number(item.composite_score || 0)
  })));
  const ratings = ratingsResult.data || [];
  const comments = commentsResult.data || [];
  const views = viewsResult.data || [];
  const feedbackLikes = feedbackLikesResult.error ? [] : (feedbackLikesResult.data || []);
  const missingMedia = buildMissingMediaReport(submissions, storageSummary);
  const ratedWorks = submissions.filter(item => Number(item.rating_count || 0) > 0);
  const creatorCount = new Set(submissions.map(item => String(item.user_id || '')).filter(Boolean)).size;

  return {
    schema_version: 'classshow-activity-snapshot-v1',
    generated_at: new Date().toISOString(),
    time_zone: APP_TIME_ZONE,
    activity_id: activityId,
    activity,
    archive_policy: archivePolicy,
    archive_provider: archiveProvider,
    ops: {
      tasks: {
        transcode: serializeTaskHealthState(backgroundTaskState.transcode),
        archive: serializeTaskHealthState(backgroundTaskState.archive)
      }
    },
    metrics: {
      participant_count: users.length,
      roster_count: roster.filter(item => item.active !== false).length,
      creator_count: creatorCount,
      submission_count: submissions.length,
      rating_count: ratings.length,
      comment_count: comments.filter(item => !!item.submission_id).length,
      feedback_count: comments.filter(item => !item.submission_id && !isWithdrawnFeedbackContent(item.content)).length,
      view_count: views.length,
      average_score: ratedWorks.length
        ? Math.round((ratedWorks.reduce((sum, item) => sum + Number(item.average_rating || 0), 0) / ratedWorks.length) * 100) / 100
        : 0
    },
    integrity: {
      missing_media_total: missingMedia.total_count,
      missing_media_source: missingMedia.source_missing_count,
      missing_media_thumbnails: missingMedia.thumbnail_missing_count,
      orphan_file_count: Number(storageSummary.orphan_count || 0),
      orphan_bytes: Number(storageSummary.orphan_bytes || 0)
    },
    storage: {
      ...storageSummary,
      _tracked_path_set: undefined
    },
    data: {
      roster_ready: rosterReady,
      roster,
      users,
      submissions,
      ratings,
      comments,
      views,
      feedback_likes: feedbackLikes
    }
  };
}

function serializeActivitySnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2);
  const sha256 = crypto.createHash('sha256').update(json).digest('hex');
  return { json, sha256 };
}

function buildTaskOpsOverview() {
  return {
    transcode: serializeTaskHealthState(backgroundTaskState.transcode),
    archive: serializeTaskHealthState(backgroundTaskState.archive)
  };
}

startTempUploadCleanupLoop();
startVideoTranscodeLoop();
startArchiveLoop();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Teacher Auth Middleware ───
function teacherAuth(req, res, next) {
  const auth = req.headers['x-teacher-auth'];
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  const signed = parseTeacherToken(auth);
  if (signed) {
    req.teacherActivityId = signed.activityId;
    req.teacherAuthMode = 'signed';
    return next();
  }

  try {
    // Backward compatibility: old token was base64(activityId:password)
    const [activityId, password] = Buffer.from(String(auth), 'base64').toString().split(':');
    if (!activityId || !password) throw new Error('Invalid');
    req.teacherActivityId = activityId;
    req.teacherPassword = password;
    req.teacherAuthMode = 'legacy';
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid auth' });
  }
}

// ─── Student Auth Middleware ───
async function studentAuth(req, res, next) {
  const token = req.headers['x-user-token'];
  const userId = req.body.user_id || req.body.rater_user_id || req.body.viewer_user_id;
  const activityId = req.body.activity_id || req.query.activity_id;
  if (!token) return res.status(401).json({ error: '身份已过期，请重新进入课堂' });

  const result = await validateStudentToken({ token, userId, activityId });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  req.studentUserId = userId;
  req.studentActivityId = activityId;
  next();
}
// ─── ACTIVITIES ───
app.post('/api/activities', async (req, res) => {
  try {
    const course_name = sanitizeText(req.body.course_name, 120);
    const class_name = sanitizeText(req.body.class_name, 120);
    const activity_name = sanitizeText(req.body.activity_name, 120);
    const description = sanitizeText(req.body.description, 500);
    const invite_code = normalizeInviteCode(req.body.invite_code);
    const teacher_password = String(req.body.teacher_password ?? '').trim();
    if (!course_name || !class_name || !activity_name || !invite_code || !teacher_password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase.from('activities').insert([{
      course_name, class_name, activity_name, description, invite_code, teacher_password
    }]).select().single();
    if (error) throw error;
    res.status(201).json(sanitizeActivity(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/activities/code/:code', async (req, res) => {
  try {
    const { data, error } = await fetchActivityByCode(req.params.code);
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(404).json({ error: 'Activity not found' }); }
});

app.put('/api/activities/:id', teacherAuth, async (req, res) => {
  try {
    const auth = await ensureTeacherCanAccessActivity(req, req.params.id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const allowed = ['upload_open', 'voting_open', 'comments_open', 'show_live_ranking', 'roster_enabled', 'pin_required', 'description', 'activity_name', 'feedback_daily_limit', 'archive_after_days', 'archive_delete_primary_after_success'];
    const payload = {};
    for (const key of allowed) {
      if (!(key in req.body)) continue;
      if (key === 'description') payload[key] = sanitizeText(req.body[key], 500);
      else if (key === 'activity_name') payload[key] = sanitizeText(req.body[key], 120);
      else if (key === 'feedback_daily_limit') payload[key] = parseFeedbackDailyLimitInput(req.body[key]);
      else if (key === 'archive_after_days') payload[key] = parseArchiveAfterDaysInput(req.body[key]);
      else payload[key] = coerceBoolean(req.body[key]);
    }

    const { data, error } = await supabase.from('activities').update(payload).eq('id', req.params.id).select().single();
    if (error && /feedback_daily_limit|archive_after_days|archive_delete_primary_after_success/i.test(error.message || '')) {
      return res.status(500).json({ error: 'Archive or feedback schema is not ready. Run upgrade_v4.sql first.' });
    }
    if (error) throw error;
    res.json(sanitizeActivity(data));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ─── USERS ───
app.post('/api/users', async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const name = sanitizeText(req.body.name, 80);
    const student_id = sanitizeText(req.body.student_id, 80);
    const class_name = sanitizeText(req.body.class_name, 80);
    const group_name = sanitizeText(req.body.group_name, 80) || null;
    const pin = String(req.body.pin ?? '').trim();
    if (!activity_id || !student_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const rosterAuth = await validateRosterLogin(activity_id, student_id, name, pin);
    if (rosterAuth.required && !rosterAuth.ok) {
      return res.status(rosterAuth.status).json({ error: rosterAuth.error });
    }

    const finalName = rosterAuth.roster?.name || name;
    const finalClassName = rosterAuth.roster?.class_name || class_name;
    const finalGroupName = rosterAuth.roster?.group_name || group_name;
    if (!finalName || !finalClassName) {
      return res.status(400).json({ error: 'Missing name or class name' });
    }

    // Check if user already exists (allow re-entry)
    const { data: existing } = await supabase.from('users')
      .select('*').eq('activity_id', activity_id).eq('student_id', student_id).maybeSingle();
    if (existing) {
      const updatePayload = {};
      if (rosterAuth.roster && (existing.name !== finalName || existing.class_name !== finalClassName || existing.group_name !== finalGroupName)) {
        updatePayload.name = finalName;
        updatePayload.class_name = finalClassName;
        updatePayload.group_name = finalGroupName;
      }
      if (Object.keys(updatePayload).length > 0) {
        await supabase.from('users').update(updatePayload).eq('id', existing.id);
        Object.assign(existing, updatePayload);
      }
      existing.token = makeStudentToken(existing.activity_id, existing.id);
      return res.json(existing);
    }
    const { data, error } = await supabase.from('users').insert([{
      activity_id, name: finalName, student_id, class_name: finalClassName, group_name: finalGroupName
    }]).select().single();
    if (error) throw error;
    data.token = makeStudentToken(data.activity_id, data.id);
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function getActivityDefaultClassName(activityId) {
  const { data, error } = await supabase.from('activities').select('class_name').eq('id', activityId).single();
  if (error) throw error;
  return sanitizeText(data?.class_name, 80) || '未分班';
}

async function importRosterStudentsForActivity(req, { activity_id, students, default_class_name }) {
  if (!activity_id) {
    const err = new Error('Missing activity_id');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(students) || students.length === 0) {
    const err = new Error('No students to import');
    err.status = 400;
    throw err;
  }
  if (students.length > 1000) {
    const err = new Error('Import at most 1000 students at a time');
    err.status = 400;
    throw err;
  }

  const auth = await ensureTeacherCanAccessActivity(req, activity_id);
  if (!auth.ok) {
    const err = new Error(auth.error);
    err.status = auth.status;
    throw err;
  }

  const fallbackClassName = sanitizeText(default_class_name, 80) || await getActivityDefaultClassName(activity_id);
  const payload = [];
  const seen = new Set();
  for (const row of students) {
    const student_id = sanitizeText(row.student_id, 80);
    const name = sanitizeText(row.name, 80);
    if (!student_id || !name || seen.has(student_id)) continue;
    seen.add(student_id);

    payload.push({
      activity_id,
      student_id,
      name,
      class_name: sanitizeText(row.class_name, 80) || fallbackClassName,
      group_name: sanitizeText(row.group_name, 80) || null,
      active: row.active === false ? false : true,
      pin_hash: null,
      pin_salt: null
    });
  }

  if (payload.length === 0) {
    const err = new Error('No valid roster rows. The roster must include name and student ID.');
    err.status = 400;
    throw err;
  }

  const { error } = await supabase.from('student_roster')
    .upsert(payload, { onConflict: 'activity_id,student_id' });
  if (error) throw error;

  const update = await supabase.from('activities')
    .update({ roster_enabled: true, pin_required: false })
    .eq('id', activity_id)
    .select('id,roster_enabled,pin_required')
    .single();
  if (update.error) throw update.error;

  return { ok: true, imported: payload.length, activity: update.data };
}

async function readRosterStudentsFromFile(file, defaultClassName) {
  const filename = String(file?.originalname || '').toLowerCase();
  if (!file?.buffer) return [];
  let rows = [];
  if (filename.endsWith('.csv')) {
    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    rows = text.split(/\r?\n/).map(parseCsvLine);
  } else if (filename.endsWith('.xlsx')) {
    const parsed = await readXlsxFile(file.buffer);
    if (Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].data)) {
      const sheet = parsed.find(item => Array.isArray(item.data) && item.data.some(row => row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''))) || parsed[0];
      rows = sheet.data;
    } else {
      rows = parsed;
    }
  } else {
    const err = new Error('Only .xlsx and .csv roster files are supported');
    err.status = 400;
    throw err;
  }
  return normalizeRosterRows(rows, defaultClassName);
}

function rosterImportErrorMessage(error) {
  const message = error?.message || '';
  if (/row-level security|RLS/i.test(message)) {
    return 'Student roster writes are blocked by Supabase RLS. Re-run the latest upgrade_v4.sql or add SUPABASE_SERVICE_ROLE_KEY on Render.';
  }
  if (/student_roster|pin_hash|pin_salt|constraint|conflict|roster_enabled|pin_required/i.test(message)) {
    return 'Student roster schema is not ready. Run upgrade_v4.sql first.';
  }
  return message || 'Roster import failed';
}

app.get('/api/teacher/roster', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    let { data, error } = await supabase.from('student_roster')
      .select('id,student_id,name,class_name,group_name,active,feedback_muted,created_at')
      .eq('activity_id', activity_id)
      .order('student_id', { ascending: true });
    if (error && /feedback_muted/i.test(error.message || '')) {
      const retry = await supabase.from('student_roster')
        .select('id,student_id,name,class_name,group_name,active,created_at')
        .eq('activity_id', activity_id)
        .order('student_id', { ascending: true });
      data = (retry.data || []).map(row => ({ ...row, feedback_muted: false }));
      error = retry.error;
    }
    if (error) {
      if (/student_roster/i.test(error.message || '')) {
        return res.status(500).json({ error: 'Student roster table is not ready. Run upgrade_v4.sql first.' });
      }
      throw error;
    }
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/teacher/roster/import', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const rawStudents = Array.isArray(req.body.students) ? req.body.students : [];
    const students = normalizeRosterRows(
      rawStudents.map(row => [row.name, row.student_id, row.class_name, row.group_name, row.pin]),
      req.body.default_class_name
    );
    const result = await importRosterStudentsForActivity(req, {
      activity_id,
      students,
      default_class_name: req.body.default_class_name
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: rosterImportErrorMessage(e) });
  }
});

app.post('/api/teacher/roster/import-file', teacherAuth, rosterUpload.single('roster'), async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    if (!req.file) return res.status(400).json({ error: 'Missing roster file' });
    const students = await readRosterStudentsFromFile(req.file, req.body.default_class_name);
    const result = await importRosterStudentsForActivity(req, {
      activity_id,
      students,
      default_class_name: req.body.default_class_name
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: rosterImportErrorMessage(e) });
  }
});

// ─── MEDIA UPLOAD (image + video) ───
app.post('/api/upload', upload.single('image'), async (req, res) => {
  let tempFiles = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const token = req.headers['x-user-token'];
    const userId = req.body.user_id;
    const activityId = req.body.activity_id;
    const auth = await validateStudentToken({ token, userId, activityId });
    if (!auth.ok) {
      if (req.file.path) fs.unlink(req.file.path, () => {});
      return res.status(auth.status).json({ error: auth.error });
    }
    await ensureUploadOpen(activityId);

    const processed = await prepareUploadedMedia(req.file);
    tempFiles = Array.isArray(processed.tempFiles) ? processed.tempFiles : [req.file.path];
    const folder = processed.mediaType === 'video' ? 'videos' : 'uploads';
    const filename = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${processed.storageExt}`;
    await uploadLocalFileToPrimaryStorage(processed.finalPath, filename, processed.contentType);
    const { data: urlData } = supabase.storage.from('submissions').getPublicUrl(filename);

    let thumbnailPath = null;
    let thumbnailUrl = null;
    if (processed.thumbnail?.finalPath) {
      thumbnailPath = createSidecarStoragePath(filename, MEDIA_THUMBNAIL_FOLDER, processed.thumbnail.storageExt);
      if (thumbnailPath) {
        await uploadLocalFileToPrimaryStorage(processed.thumbnail.finalPath, thumbnailPath, processed.thumbnail.contentType);
        thumbnailUrl = publicUrlForStoragePath(thumbnailPath);
      }
    }

    await Promise.all(tempFiles.map(filePath => safeUnlink(filePath)));
    res.json({
      url: urlData.publicUrl,
      path: filename,
      type: processed.mediaType,
      size: processed.size,
      original_size: processed.originalSize,
      compressed: !!processed.optimized,
      saved_bytes: processed.savedBytes,
      saved_percent: processed.originalSize > 0
        ? Math.round((processed.savedBytes / processed.originalSize) * 100)
        : 0,
      thumbnail_url: thumbnailUrl,
      thumbnail_path: thumbnailPath,
      transcode_status: processed.transcodeStatus || 'ready',
      processing: !!processed.asyncProcessing
    });
  } catch (e) { 
    await Promise.all(tempFiles.map(filePath => safeUnlink(filePath)));
    if (req.file?.path) await safeUnlink(req.file.path);
    res.status(e.status || 500).json({ error: e.message }); 
  }
});

// ─── SUBMISSIONS ───
app.post('/api/submissions', studentAuth, async (req, res) => {
  let newStoragePath = null;
  let shouldCleanupNewMedia = false;
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const user_id = String(req.body.user_id ?? '').trim();
    const submission_id = String(req.body.submission_id ?? '').trim() || null;
    const media_changed = coerceBoolean(req.body.media_changed);
    const rawTitle = sanitizeText(req.body.title, 140);
    const title = withUploadTimestampTitle(rawTitle);
    const description = sanitizeText(req.body.description, 400);
    const uploadedStoragePath = sanitizeStoragePath(req.body.storage_path);
    const storage_path = uploadedStoragePath || storagePathFromPublicUrl(req.body.image_url);
    const image_url = publicUrlForStoragePath(storage_path);
    const media_type = isVideoFilePath(storage_path) ? 'video' : 'image';
    const media_size = Number.isFinite(Number(req.body.media_size)) ? Number(req.body.media_size) : null;
    const thumbnail_path = sanitizeStoragePath(req.body.thumbnail_path);
    const thumbnail_url = sanitizeMediaUrl(req.body.thumbnail_url) || publicUrlForStoragePath(thumbnail_path);
    const original_media_size = Number.isFinite(Number(req.body.original_media_size)) ? Number(req.body.original_media_size) : (media_size || 0);
    const compressed = coerceBoolean(req.body.compressed);
    const saved_bytes = Number.isFinite(Number(req.body.saved_bytes)) ? Number(req.body.saved_bytes) : 0;
    const saved_percent = Number.isFinite(Number(req.body.saved_percent)) ? Number(req.body.saved_percent) : 0;
    const transcode_status = media_type === 'video'
      ? String(req.body.transcode_status || (ASYNC_VIDEO_TRANSCODE ? 'pending' : 'ready'))
      : 'ready';
    if (!activity_id || !user_id || !rawTitle || !storage_path || !image_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    newStoragePath = storage_path;
    shouldCleanupNewMedia = !!uploadedStoragePath;
    await ensureUploadOpen(activity_id);

    if (submission_id) {
      const { data: existing, error: existingError } = await fetchSubmissionWithMedia(
        submission_id,
        'id,activity_id,user_id,edit_count'
      );
      if (existingError || !existing) {
        const err = new Error('Submission not found');
        err.status = 404;
        throw err;
      }
      if (String(existing.activity_id) !== String(activity_id)) {
        const err = new Error('Submission/activity mismatch');
        err.status = 400;
        throw err;
      }
      if (String(existing.user_id) !== String(user_id)) {
        const err = new Error('Unauthorized');
        err.status = 403;
        throw err;
      }

      const existingManifest = normalizeSubmissionMediaManifest(existing, await readSubmissionMediaManifest(existing.id).catch(() => null));
      const oldStoragePath = sanitizeStoragePath(existing.storage_path) || storagePathFromPublicUrl(existing.image_url);
      const nextManifest = normalizeSubmissionMediaManifest(existing, media_changed ? {
        ...existingManifest,
        media_type,
        thumbnail_path,
        thumbnail_url,
        poster_url: thumbnail_url,
        transcode_status,
        transcode_error: null,
        transcoded_at: media_type === 'video' ? null : new Date().toISOString(),
        original_media_size,
        compressed,
        saved_bytes,
        saved_percent,
        archive_tier: 'hot',
        archive_status: ARCHIVE_PROVIDER === 'none' ? 'disabled' : 'pending',
        archive_provider: null,
        archive_key: null,
        archive_url: null,
        archive_thumbnail_key: null,
        archive_thumbnail_url: null,
        archive_error: null,
        archived_at: null
      } : {
        ...existingManifest,
        thumbnail_path: thumbnail_path || existingManifest.thumbnail_path,
        thumbnail_url: thumbnail_url || existingManifest.thumbnail_url
      });

      const now = new Date().toISOString();
      const payload = {
        title,
        description,
        image_url,
        storage_path,
        media_type,
        media_size,
        upload_time: now,
        last_modified_time: now,
        edit_count: (existing.edit_count || 0) + 1,
        view_count: 0,
        rating_count: 0,
        average_rating: 0,
        composite_score: 0,
        teacher_score: null,
        final_score: null,
        rank: null,
        is_pinned: false,
        is_teacher_selected: false,
        status: 'visible'
      };
      let { data, error } = await supabase.from('submissions')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error && /storage_path|media_type|media_size/i.test(error.message || '')) {
        const legacyPayload = { ...payload };
        delete legacyPayload.storage_path;
        delete legacyPayload.media_type;
        delete legacyPayload.media_size;
        ({ data, error } = await supabase.from('submissions')
          .update(legacyPayload)
          .eq('id', existing.id)
          .select()
          .single());
      }
      if (error) throw error;
      shouldCleanupNewMedia = false;
      await clearSubmissionEngagement(existing.id);
      if (oldStoragePath && oldStoragePath !== storage_path) {
        await deleteStorageObject(oldStoragePath);
      }
      if (media_changed && existingManifest.thumbnail_path && existingManifest.thumbnail_path !== thumbnail_path) {
        await deleteStorageObject(existingManifest.thumbnail_path);
      }
      if (media_changed) {
        await deleteArchiveObject(existingManifest.archive_key, existingManifest.archive_provider);
        await deleteArchiveObject(existingManifest.archive_thumbnail_key, existingManifest.archive_provider);
      }
      const manifest = await writeSubmissionMediaManifest(existing.id, nextManifest);
      return res.json(mergeSubmissionWithManifest(data, manifest));
    }

    const code = await generateNextAnonymousCode(activity_id);
    const insertPayload = {
      activity_id,
      user_id,
      anonymous_code: code,
      title,
      description,
      image_url,
      storage_path,
      media_type,
      media_size
    };

    let { data, error } = await supabase.from('submissions').insert([insertPayload]).select().single();
    if (error && /storage_path|media_type|media_size/i.test(error.message || '')) {
      const legacyPayload = { ...insertPayload };
      delete legacyPayload.storage_path;
      delete legacyPayload.media_type;
      delete legacyPayload.media_size;
      ({ data, error } = await supabase.from('submissions').insert([legacyPayload]).select().single());
    }
    if (error && /submissions_activity_user_uidx|duplicate key|unique constraint/i.test(error.message || '')) {
      if (shouldCleanupNewMedia && newStoragePath) await deleteStorageObject(newStoragePath);
      shouldCleanupNewMedia = false;
      return res.status(409).json({
        error: 'Database still enforces one submission per student. Run upgrade_v4.sql to drop submissions_activity_user_uidx.'
      });
    }
    if (error) throw error;
    shouldCleanupNewMedia = false;
    const manifest = await writeSubmissionMediaManifest(data.id, {
      media_type,
      thumbnail_path,
      thumbnail_url,
      poster_url: thumbnail_url,
      transcode_status,
      transcode_error: null,
      transcode_attempts: 0,
      transcoded_at: media_type === 'video' ? null : new Date().toISOString(),
      original_media_size,
      compressed,
      saved_bytes,
      saved_percent,
      archive_tier: 'hot',
      archive_status: ARCHIVE_PROVIDER === 'none' ? 'disabled' : 'pending',
      archive_provider: null,
      archive_key: null,
      archive_url: null,
      archive_thumbnail_key: null,
      archive_thumbnail_url: null,
      archive_attempts: 0,
      archive_error: null,
      archived_at: null
    });
    res.status(201).json(mergeSubmissionWithManifest(data, manifest));
  } catch (e) {
    if (shouldCleanupNewMedia && newStoragePath) await deleteStorageObject(newStoragePath);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Student: get anonymous submissions
app.get('/api/submissions', async (req, res) => {
  try {
    const { activity_id, viewer_user_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });

    let viewerUserId = null;
    const token = req.headers['x-user-token'];
    if (token && viewer_user_id && activity_id) {
      const auth = await validateStudentToken({ token, userId: viewer_user_id, activityId: activity_id });
      if (auth.ok) viewerUserId = String(viewer_user_id);
    }

    let subsResult = await supabase.from('submissions')
      .select('id,anonymous_code,title,description,image_url,storage_path,media_type,media_size,upload_time,view_count,rating_count,average_rating,composite_score,is_pinned,is_teacher_selected,status,user_id')
      .eq('activity_id', activity_id).eq('status', 'visible')
      .order('upload_time', { ascending: false });
    if (subsResult.error && /storage_path|media_type/i.test(subsResult.error.message || '')) {
      subsResult = await supabase.from('submissions')
        .select('id,anonymous_code,title,description,image_url,upload_time,view_count,rating_count,average_rating,composite_score,is_pinned,is_teacher_selected,status,user_id')
        .eq('activity_id', activity_id).eq('status', 'visible')
        .order('upload_time', { ascending: false });
    }

    const commentsResult = await supabase.from('comments').select('submission_id').eq('activity_id', activity_id);
    if (subsResult.error) throw subsResult.error;
    // Build comment count map from live data
    const ccMap = {};
    (commentsResult.data || []).forEach(c => { ccMap[c.submission_id] = (ccMap[c.submission_id] || 0) + 1; });
    const baseRows = (subsResult.data || []).map(s => {
      const is_owner = !!viewerUserId && String(s.user_id) === viewerUserId;
      const { user_id, ...safe } = s;
      return { ...safe, image_url: sanitizeMediaUrl(safe.image_url) || '', is_owner, comment_count: ccMap[s.id] || 0 };
    });
    const result = await enrichSubmissionMediaRows(baseRows);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/submissions/:id', async (req, res) => {
  try {
    const { viewer_user_id } = req.query;
    const [subResult, commentsResult] = await Promise.all([
      supabase.from('submissions')
        .select('id,anonymous_code,title,description,image_url,storage_path,media_type,media_size,upload_time,view_count,rating_count,average_rating,user_id,activity_id')
        .eq('id', req.params.id).single(),
      supabase.from('comments').select('id', { count: 'exact', head: true }).eq('submission_id', req.params.id)
    ]);
    if (subResult.error) throw subResult.error;
    let is_owner = false;
    if (req.headers['x-user-token'] && viewer_user_id && subResult.data?.activity_id) {
      const auth = await validateStudentToken({
        token: req.headers['x-user-token'],
        userId: viewer_user_id,
        activityId: subResult.data.activity_id
      });
      if (auth.ok && String(subResult.data.user_id) === String(viewer_user_id)) is_owner = true;
    }
    const { user_id, activity_id, ...safe } = subResult.data;
    const [enriched] = await enrichSubmissionMediaRows([{ ...safe, image_url: sanitizeMediaUrl(safe.image_url) || '', is_owner, comment_count: commentsResult.count || 0 }]);
    res.json(enriched);
  } catch (e) { res.status(404).json({ error: 'Not found' }); }
});

// Teacher: get all submissions with real names
app.get('/api/teacher/submissions', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const [subsResult, commentsResult] = await Promise.all([
      supabase.from('submissions')
        .select('*, users(name, student_id, class_name, group_name)')
        .eq('activity_id', activity_id).order('upload_time', { ascending: true }),
      supabase.from('comments').select('submission_id').eq('activity_id', activity_id)
    ]);
    if (subsResult.error) throw subsResult.error;
    const ccMap = {};
    (commentsResult.data || []).forEach(c => { ccMap[c.submission_id] = (ccMap[c.submission_id] || 0) + 1; });
    const result = await enrichSubmissionMediaRows((subsResult.data || []).map(s => ({ ...s, image_url: sanitizeMediaUrl(s.image_url) || '', comment_count: ccMap[s.id] || 0 })));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/teacher/submissions/:id', teacherAuth, async (req, res) => {
  try {
    const { data: sub, error: subErr } = await fetchSubmissionWithMedia(req.params.id, 'id,activity_id');
    if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

    const auth = await ensureTeacherCanAccessActivity(req, sub.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const allowed = ['is_pinned', 'is_teacher_selected', 'status', 'teacher_score', 'final_score', 'title', 'description'];
    const payload = {};
    for (const key of allowed) {
      if (!(key in req.body)) continue;
      if (key === 'title') payload[key] = sanitizeText(req.body[key], 140);
      else if (key === 'description') payload[key] = sanitizeText(req.body[key], 400);
      else payload[key] = req.body[key];
    }
    const { data, error } = await supabase.from('submissions').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/teacher/submissions/:id', teacherAuth, async (req, res) => {
  try {
    const { data: sub, error: subErr } = await fetchSubmissionWithMedia(req.params.id, 'id,activity_id');
    if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

    const auth = await ensureTeacherCanAccessActivity(req, sub.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    await supabase.from('submissions').delete().eq('id', req.params.id);
    await deleteSubmissionMedia(sub);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/teacher/submissions/:id/repair-thumbnail', teacherAuth, async (req, res) => {
  try {
    const { data: sub, error: subErr } = await supabase.from('submissions')
      .select('id,activity_id,title,image_url,storage_path,media_type,media_size,upload_time,user_id,users(name,student_id,class_name,group_name)')
      .eq('id', req.params.id)
      .single();
    if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

    const auth = await ensureTeacherCanAccessActivity(req, sub.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const repaired = await repairSubmissionThumbnail(sub);
    res.json({ ok: true, submission: repaired });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/teacher/submissions/:id/repair-media', teacherAuth, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing repair media file' });
    const { data: sub, error: subErr } = await supabase.from('submissions')
      .select('id,activity_id,title,image_url,storage_path,media_type,media_size,upload_time,user_id,users(name,student_id,class_name,group_name)')
      .eq('id', req.params.id)
      .single();
    if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

    const auth = await ensureTeacherCanAccessActivity(req, sub.activity_id);
    if (!auth.ok) {
      await safeUnlink(req.file.path);
      return res.status(auth.status).json({ error: auth.error });
    }

    const repaired = await replaceTeacherSubmissionMedia(sub, req.file);
    res.json({ ok: true, submission: repaired });
  } catch (e) {
    if (req.file?.path) await safeUnlink(req.file.path);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/teacher/submissions/:id/restore-archive', teacherAuth, async (req, res) => {
  try {
    const { data: sub, error: subErr } = await supabase.from('submissions')
      .select('id,activity_id,title,image_url,storage_path,media_type,media_size,upload_time,user_id,users(name,student_id,class_name,group_name)')
      .eq('id', req.params.id)
      .single();
    if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

    const auth = await ensureTeacherCanAccessActivity(req, sub.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const restored = await restoreSubmissionFromArchive(sub);
    res.json({ ok: true, submission: restored });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Student: delete own submission
app.delete('/api/submissions/:id', studentAuth, async (req, res) => {
  try {
    const { user_id, activity_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    // Verify ownership
    const { data: sub } = await fetchSubmissionWithMedia(req.params.id, 'user_id,activity_id');
    if (!sub || sub.user_id !== user_id) return res.status(403).json({ error: 'Unauthorized' });
    if (String(sub.activity_id) !== String(activity_id)) return res.status(403).json({ error: 'Activity mismatch' });
    
    await supabase.from('submissions').delete().eq('id', req.params.id);
    await deleteSubmissionMedia(sub);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── RATINGS ───
app.post('/api/ratings', studentAuth, async (req, res) => {
  try {
    const { activity_id, submission_id, rater_user_id, score } = req.body;
    const scoreNum = Number(score);
    if (!Number.isFinite(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      return res.status(400).json({ error: 'Score must be between 1 and 5' });
    }

    // Check: can't rate own submission
    const { data: sub } = await supabase.from('submissions').select('user_id,activity_id').eq('id', submission_id).single();
    if (!sub || String(sub.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Submission/activity mismatch' });
    }
    if (sub && String(sub.user_id) === String(rater_user_id)) return res.status(403).json({ error: 'Cannot rate your own work' });

    const { data: act } = await supabase.from('activities').select('voting_open').eq('id', activity_id).single();
    if (act && act.voting_open === false) return res.status(403).json({ error: 'Voting is closed by teacher' });

    const upsertPayload = {
      activity_id,
      submission_id,
      rater_user_id,
      score: scoreNum,
      updated_at: new Date().toISOString()
    };
    let { error: upsertError } = await supabase.from('ratings')
      .upsert([upsertPayload], { onConflict: 'submission_id,rater_user_id' });
    if (upsertError && /unique|constraint|conflict/i.test(upsertError.message || '')) {
      const { data: existing } = await supabase.from('ratings')
        .select('id').eq('submission_id', submission_id).eq('rater_user_id', rater_user_id).maybeSingle();
      if (existing) {
        const { error } = await supabase.from('ratings').update({ score: scoreNum, updated_at: new Date().toISOString() }).eq('id', existing.id);
        upsertError = error;
      } else {
        const { error } = await supabase.from('ratings').insert([{ activity_id, submission_id, rater_user_id, score: scoreNum }]);
        upsertError = error;
      }
    }
    if (upsertError) throw upsertError;

    // Recalculate average
    const { data: allRatings } = await supabase.from('ratings').select('score').eq('submission_id', submission_id);
    const avg = allRatings.reduce((s, r) => s + r.score, 0) / allRatings.length;
    await supabase.from('submissions').update({
      average_rating: Math.round(avg * 100) / 100, rating_count: allRatings.length
    }).eq('id', submission_id);
    res.json({ ok: true, average: avg, count: allRatings.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ratings/my', async (req, res) => {
  try {
    const { activity_id, user_id } = req.query;
    if (!activity_id || !user_id) return res.status(400).json({ error: 'Missing activity_id or user_id' });
    const token = req.headers['x-user-token'];
    const auth = await validateStudentToken({ token, userId: user_id, activityId: activity_id });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data, error } = await supabase.from('ratings').select('submission_id,score')
      .eq('activity_id', activity_id).eq('rater_user_id', user_id);
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── COMMENTS ───
app.post('/api/comments', studentAuth, async (req, res) => {
  try {
    const { activity_id, submission_id, user_id, content } = req.body;
    if (!activity_id || !submission_id || !user_id || !content?.trim()) {
      return res.status(400).json({ error: '缂哄皯蹇呰瀛楁' });
    }
    const { data: sub } = await supabase.from('submissions').select('id,activity_id,user_id').eq('id', submission_id).single();
    if (!sub || String(sub.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Submission/activity mismatch' });
    }
    if (String(sub.user_id) === String(user_id)) {
      return res.status(403).json({ error: 'Cannot comment on your own work' });
    }

    // Check if comments are open; if the column doesn't exist yet, allow it through
    try {
      const { data: act } = await supabase.from('activities').select('comments_open').eq('id', activity_id).single();
      if (act && act.comments_open === false) {
        return res.status(403).json({ error: 'Comments are closed by teacher' });
      }
    } catch (checkErr) {
      // Column may not exist yet (SQL not run); allow through.
      console.warn('comments_open check failed, allowing comment:', checkErr.message);
    }
    const safeContent = sanitizeText(content, 200);
    const { data, error } = await supabase.from('comments').insert([{
      activity_id, submission_id, user_id, content: safeContent
    }]).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/comments', async (req, res) => {
  try {
    const { submission_id } = req.query;
    if (!submission_id) return res.json([]);
    const { data, error } = await supabase.from('comments')
      .select('id, content, created_at')
      .eq('submission_id', submission_id).order('created_at', { ascending: true });
    if (error) {
      // Table may not exist yet; return empty gracefully.
      console.warn('Comments table error (may not exist yet):', error.message);
      return res.json([]);
    }
    res.json(data || []);
  } catch (e) { res.json([]); }
});

function normalizeFeedbackSort(input) {
  return String(input ?? '').trim().toLowerCase() === 'hot' ? 'hot' : 'latest';
}

function isFeedbackLikesSchemaError(message) {
  return /activity_feedback_likes|does not exist|schema cache/i.test(message || '');
}

function isFeedbackLikesRlsError(message) {
  return /row-level security|violates row-level security policy|42501/i.test(message || '');
}

function feedbackLikesWriteErrorMessage(error) {
  const message = error?.message || '';
  if (isFeedbackLikesRlsError(message)) {
    return 'Feedback likes writes are blocked by Supabase RLS. Re-run the latest upgrade_v4.sql.';
  }
  if (isFeedbackLikesSchemaError(message)) {
    return 'Feedback likes schema is not ready. Run upgrade_v4.sql first.';
  }
  return message || 'Feedback like failed';
}

function isFeedbackModerationSchemaError(message) {
  return /feedback_muted|feedback_daily_limit/i.test(message || '');
}

function feedbackModerationWriteErrorMessage(error) {
  const message = error?.message || '';
  if (isFeedbackModerationSchemaError(message) || /student_roster/i.test(message)) {
    return 'Feedback moderation schema is not ready. Run upgrade_v4.sql first.';
  }
  return message || 'Feedback moderation update failed';
}

async function fetchActivityFeedbackSettings(activityId) {
  const { data, error } = await supabase.from('activities')
    .select('id,feedback_daily_limit')
    .eq('id', activityId)
    .single();
  if (error && isFeedbackModerationSchemaError(error.message || '')) {
    return { ready: false, daily_limit: DEFAULT_FEEDBACK_DAILY_LIMIT };
  }
  if (error) throw error;
  return {
    ready: true,
    daily_limit: normalizeFeedbackDailyLimit(data?.feedback_daily_limit)
  };
}

async function fetchUserFeedbackPostingState(activityId, userId) {
  const settings = await fetchActivityFeedbackSettings(activityId);
  const { startIso, endIso } = getBangkokDayRange();
  const [{ data: user, error: userError }, { count, error: countError }] = await Promise.all([
    supabase.from('users')
      .select('id,student_id')
      .eq('id', userId)
      .eq('activity_id', activityId)
      .single(),
    supabase.from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activityId)
      .eq('user_id', userId)
      .is('submission_id', null)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
  ]);
  if (userError) throw userError;
  if (countError) throw countError;

  let feedbackMuted = false;
  let rosterReady = true;
  if (user?.student_id) {
    const { data: roster, error: rosterError } = await supabase.from('student_roster')
      .select('feedback_muted')
      .eq('activity_id', activityId)
      .eq('student_id', user.student_id)
      .maybeSingle();
    if (rosterError && /student_roster/i.test(rosterError.message || '')) {
      rosterReady = false;
    } else if (rosterError && isFeedbackModerationSchemaError(rosterError.message || '')) {
      rosterReady = false;
    } else if (rosterError) {
      throw rosterError;
    } else {
      feedbackMuted = !!roster?.feedback_muted;
    }
  }

  return {
    daily_limit: settings.daily_limit,
    feedback_muted: feedbackMuted,
    feedback_count_today: count || 0,
    roster_ready: rosterReady,
    settings_ready: settings.ready,
    student_id: user?.student_id || null
  };
}

async function fetchFeedbackLikeState(activityId, viewerUserId = null) {
  try {
    const { data, error } = await supabase.from('activity_feedback_likes')
      .select('feedback_id,user_id')
      .eq('activity_id', activityId);
    if (error) throw error;
    const likeCountMap = {};
    const likedSet = new Set();
    (data || []).forEach(row => {
      likeCountMap[row.feedback_id] = (likeCountMap[row.feedback_id] || 0) + 1;
      if (viewerUserId && String(row.user_id) === String(viewerUserId)) likedSet.add(String(row.feedback_id));
    });
    return { likes_enabled: true, likeCountMap, likedSet };
  } catch (error) {
    if (/activity_feedback_likes|does not exist|schema cache/i.test(error.message || '')) {
      return { likes_enabled: false, likeCountMap: {}, likedSet: new Set() };
    }
    throw error;
  }
}

async function listActivityFeedback({ activityId, sort = 'latest', viewerUserId = null, includeUsers = false, limit = 50 }) {
  const normalizedSort = normalizeFeedbackSort(sort);
  const selectFields = includeUsers
    ? 'id,activity_id,user_id,content,created_at,users(name,student_id,class_name,group_name)'
    : 'id,activity_id,user_id,content,created_at';
  const { data, error } = await supabase.from('comments')
    .select(selectFields)
    .eq('activity_id', activityId)
    .is('submission_id', null)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 200));
  if (error) throw error;

  const likeState = await fetchFeedbackLikeState(activityId, viewerUserId);
  let rosterMuteMap = new Map();
  if (includeUsers) {
    const { data: rosterRows, error: rosterError } = await supabase.from('student_roster')
      .select('student_id,feedback_muted')
      .eq('activity_id', activityId);
    if (!rosterError) {
      rosterMuteMap = new Map((rosterRows || []).map(row => [String(row.student_id || ''), !!row.feedback_muted]));
    } else if (!/student_roster/i.test(rosterError.message || '') && !isFeedbackModerationSchemaError(rosterError.message || '')) {
      throw rosterError;
    }
  }
  const items = (data || [])
    .filter(row => !isWithdrawnFeedbackContent(row.content))
    .map(row => ({
    ...row,
    label: '实名反馈',
    like_count: likeState.likeCountMap[row.id] || 0,
    liked_by_me: likeState.likedSet.has(String(row.id)),
    feedback_muted: includeUsers ? !!rosterMuteMap.get(String(row.users?.student_id || '')) : false
  }));

  items.sort((a, b) => {
    if (normalizedSort === 'hot') {
      if ((b.like_count || 0) !== (a.like_count || 0)) return (b.like_count || 0) - (a.like_count || 0);
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return {
    sort: normalizedSort,
    likes_enabled: likeState.likes_enabled,
    items: items.slice(0, limit)
  };
}

app.get('/api/activity-feedback', async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    let viewerUserId = null;
    let viewerState = {
      daily_limit: DEFAULT_FEEDBACK_DAILY_LIMIT,
      feedback_muted: false,
      feedback_count_today: 0
    };
    const token = req.headers['x-user-token'];
    if (token && req.query.user_id) {
      const auth = await validateStudentToken({
        token,
        userId: req.query.user_id,
        activityId: activity_id
      });
      if (auth.ok) {
        viewerUserId = String(req.query.user_id);
        viewerState = await fetchUserFeedbackPostingState(activity_id, viewerUserId);
      }
    }
    const feedbackSettings = viewerUserId
      ? { daily_limit: viewerState.daily_limit }
      : await fetchActivityFeedbackSettings(activity_id);
    const result = await listActivityFeedback({
      activityId: activity_id,
      sort: req.query.sort,
      viewerUserId,
      includeUsers: true,
      limit: 50
    });
    res.json({
      ...result,
      daily_limit: feedbackSettings.daily_limit,
      viewer_feedback_muted: !!viewerState.feedback_muted,
      viewer_feedback_count_today: viewerState.feedback_count_today || 0,
      viewer_feedback_remaining_today: feedbackSettings.daily_limit > 0
        ? Math.max(feedbackSettings.daily_limit - (viewerState.feedback_count_today || 0), 0)
        : null
    });
  } catch (e) {
    console.warn('Activity feedback query failed:', e.message);
    res.json({
      sort: normalizeFeedbackSort(req.query.sort),
      likes_enabled: false,
      items: [],
      daily_limit: DEFAULT_FEEDBACK_DAILY_LIMIT,
      viewer_feedback_muted: false,
      viewer_feedback_count_today: 0,
      viewer_feedback_remaining_today: DEFAULT_FEEDBACK_DAILY_LIMIT
    });
  }
});

app.post('/api/activity-feedback', studentAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const user_id = String(req.body.user_id ?? '').trim();
    const safeContent = sanitizeText(req.body.content, 300);
    const normalizedContent = normalizeFeedbackTextForDedup(safeContent);
    if (!activity_id || !user_id || !safeContent) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (isLowQualityFeedbackText(safeContent)) {
      return res.status(400).json({ error: '反馈内容过短或无意义，请写清具体问题后再提交' });
    }

    const postingState = await fetchUserFeedbackPostingState(activity_id, user_id);
    if (postingState.feedback_muted) {
      return res.status(403).json({ error: '你已被教师禁言反馈，当前不能继续提交信息反馈' });
    }
    if (postingState.daily_limit > 0 && postingState.feedback_count_today >= postingState.daily_limit) {
      return res.status(429).json({ error: `你今天的信息反馈次数已达上限（${postingState.daily_limit} 条）` });
    }

    const { data: history, error: historyError } = await supabase.from('comments')
      .select('id, content, created_at')
      .eq('activity_id', activity_id)
      .eq('user_id', user_id)
      .is('submission_id', null)
      .order('created_at', { ascending: false })
      .limit(FEEDBACK_HISTORY_SCAN_LIMIT);
    if (historyError && !/comments/i.test(historyError.message || '')) throw historyError;

    const feedbackHistory = history || [];
    const lastCreatedAt = feedbackHistory[0]?.created_at ? new Date(feedbackHistory[0].created_at).getTime() : 0;
    if (lastCreatedAt && Date.now() - lastCreatedAt < FEEDBACK_COOLDOWN_MS) {
      return res.status(429).json({ error: '每位学生每 60 秒只能提交 1 条信息反馈，请稍后再试' });
    }

    const duplicateExists = feedbackHistory.some(row => normalizeFeedbackTextForDedup(row.content) === normalizedContent);
    if (duplicateExists) {
      return res.status(409).json({ error: '检测到重复反馈，请不要重复提交相同内容' });
    }

    const { data, error } = await supabase.from('comments').insert([{
      activity_id,
      submission_id: null,
      user_id,
      content: safeContent
    }]).select('id, content, created_at').single();
    if (error) {
      if (/comments|does not exist|schema cache/i.test(error.message || '')) {
        return res.status(500).json({ error: 'Feedback area is not ready yet. Please enable comments schema first.' });
      }
      throw error;
    }
    res.status(201).json({ ...data, label: '实名反馈' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/activity-feedback/:id', studentAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const user_id = String(req.body.user_id ?? '').trim();
    if (!activity_id || !user_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: feedback, error: feedbackError } = await supabase.from('comments')
      .select('id,activity_id,user_id,submission_id')
      .eq('id', req.params.id)
      .single();
    if (feedbackError || !feedback || feedback.submission_id) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    if (String(feedback.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Feedback/activity mismatch' });
    }
    if (String(feedback.user_id) !== String(user_id)) {
      return res.status(403).json({ error: 'You can only delete your own feedback' });
    }
    if (isWithdrawnFeedbackContent(feedback.content)) {
      return res.status(410).json({ error: 'Feedback already withdrawn' });
    }

    const { error: deleteError } = await supabase.from('comments')
      .update({ content: makeWithdrawnFeedbackContent(feedback.content) })
      .eq('id', req.params.id);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/activity-feedback/:id/like', studentAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const user_id = String(req.body.user_id ?? '').trim();
    const feedbackId = String(req.params.id ?? '').trim();
    if (!activity_id || !user_id || !feedbackId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: feedback, error: feedbackError } = await supabase.from('comments')
      .select('id,activity_id,user_id,submission_id')
      .eq('id', feedbackId)
      .single();
    if (feedbackError || !feedback || feedback.submission_id) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    if (String(feedback.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Feedback/activity mismatch' });
    }
    if (String(feedback.user_id) === String(user_id)) {
      return res.status(403).json({ error: 'Cannot like your own suggestion' });
    }

    let existingResult = await supabase.from('activity_feedback_likes')
      .select('id')
      .eq('feedback_id', feedbackId)
      .eq('user_id', user_id)
      .maybeSingle();
    if (existingResult.error && (isFeedbackLikesSchemaError(existingResult.error.message || '') || isFeedbackLikesRlsError(existingResult.error.message || ''))) {
      return res.status(500).json({ error: feedbackLikesWriteErrorMessage(existingResult.error) });
    }
    if (existingResult.error) throw existingResult.error;

    let liked = false;
    if (existingResult.data?.id) {
      const { error } = await supabase.from('activity_feedback_likes').delete().eq('id', existingResult.data.id);
      if (error && (isFeedbackLikesSchemaError(error.message || '') || isFeedbackLikesRlsError(error.message || ''))) {
        return res.status(500).json({ error: feedbackLikesWriteErrorMessage(error) });
      }
      if (error) throw error;
    } else {
      const { error } = await supabase.from('activity_feedback_likes').insert([{
        activity_id,
        feedback_id: feedbackId,
        user_id
      }]);
      if (error && (isFeedbackLikesSchemaError(error.message || '') || isFeedbackLikesRlsError(error.message || ''))) {
        return res.status(500).json({ error: feedbackLikesWriteErrorMessage(error) });
      }
      if (error && !/duplicate|unique/i.test(error.message || '')) throw error;
      liked = true;
    }

    const { count, error: countError } = await supabase.from('activity_feedback_likes')
      .select('id', { count: 'exact', head: true })
      .eq('feedback_id', feedbackId);
    if (countError && (isFeedbackLikesSchemaError(countError.message || '') || isFeedbackLikesRlsError(countError.message || ''))) {
      return res.status(500).json({ error: feedbackLikesWriteErrorMessage(countError) });
    }
    if (countError) throw countError;
    res.json({ ok: true, liked, like_count: count || 0 });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/teacher/activity-feedback', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const feedbackSettings = await fetchActivityFeedbackSettings(activity_id);
    const result = await listActivityFeedback({
      activityId: activity_id,
      sort: req.query.sort,
      includeUsers: true,
      limit: 200
    });
    res.json({
      ...result,
      daily_limit: feedbackSettings.daily_limit
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/teacher/activity-feedback-moderation', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const student_id = sanitizeText(req.body.student_id, 80);
    const feedback_muted = coerceBoolean(req.body.feedback_muted);
    if (!activity_id || !student_id) {
      return res.status(400).json({ error: 'Missing activity_id or student_id' });
    }

    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data, error } = await supabase.from('student_roster')
      .update({ feedback_muted })
      .eq('activity_id', activity_id)
      .eq('student_id', student_id)
      .select('id,student_id,name,feedback_muted')
      .maybeSingle();
    if (error && (isFeedbackModerationSchemaError(error.message || '') || /student_roster/i.test(error.message || ''))) {
      return res.status(500).json({ error: feedbackModerationWriteErrorMessage(error) });
    }
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Student roster record not found' });
    }
    res.json({ ok: true, roster: data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/teacher/activity-feedback/:id', teacherAuth, async (req, res) => {
  try {
    const { data: feedback, error: feedbackErr } = await supabase.from('comments')
      .select('id, activity_id, submission_id, content')
      .eq('id', req.params.id)
      .single();
    if (feedbackErr || !feedback || feedback.submission_id) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    const auth = await ensureTeacherCanAccessActivity(req, feedback.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const nextContent = isWithdrawnFeedbackContent(feedback.content)
      ? feedback.content
      : makeWithdrawnFeedbackContent(feedback.content);
    const { error: deleteError } = await supabase.from('comments')
      .update({ content: nextContent })
      .eq('id', req.params.id);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/teacher/comments/:id', teacherAuth, async (req, res) => {
  try {
    const { data: comment, error: commentErr } = await supabase.from('comments')
      .select('id, activity_id')
      .eq('id', req.params.id)
      .single();
    if (commentErr || !comment) return res.status(404).json({ error: 'Comment not found' });

    const auth = await ensureTeacherCanAccessActivity(req, comment.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    await supabase.from('comments').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── RANKINGS ───
app.get('/api/rankings', async (req, res) => {
  try {
    const { activity_id } = req.query;
    const { data, error } = await supabase.from('submissions')
      .select('id,anonymous_code,title,average_rating,rating_count,view_count,composite_score,image_url')
      .eq('activity_id', activity_id).eq('status', 'visible').order('composite_score', { ascending: false });
    if (error) throw error;
    (data || []).forEach(d => { d.image_url = sanitizeMediaUrl(d.image_url) || ''; });
    // Calculate composite scores
    if (data.length > 0) {
      const maxRC = Math.max(...data.map(d => d.rating_count), 1);
      data.forEach((d, i) => {
        const normRC = d.rating_count / maxRC * 5;
        d.composite_score = Math.round(((Number(d.average_rating) || 0) * 0.8 + normRC * 0.2) * 100) / 100;
        d.rank = i + 1;
      });
      data.sort((a, b) => b.composite_score - a.composite_score || b.rating_count - a.rating_count || b.average_rating - a.average_rating);
      data.forEach((d, i) => d.rank = i + 1);
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── VIEWS ───
app.post('/api/views', studentAuth, async (req, res) => {
  try {
    const { submission_id, viewer_user_id, activity_id } = req.body;
    if (!submission_id || !viewer_user_id || !activity_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: sub } = await supabase.from('submissions').select('id,activity_id,user_id,view_count').eq('id', submission_id).single();
    if (!sub || String(sub.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Submission/activity mismatch' });
    }
    if (String(sub.user_id) === String(viewer_user_id)) {
      return res.json({ ok: true, owner: true });
    }

    // Count one valid view per logged-in viewer per work. This keeps refresh/scripts from inflating rankings.
    const { data: recent } = await supabase.from('views').select('id')
      .eq('submission_id', submission_id).eq('viewer_user_id', viewer_user_id)
      .limit(1);
    if (recent && recent.length > 0) return res.json({ ok: true, duplicate: true });
    const { error: insertError } = await supabase.from('views').insert([{ submission_id, viewer_user_id, is_valid: true }]);
    if (insertError && !/duplicate|unique/i.test(insertError.message || '')) throw insertError;

    const { count } = await supabase.from('views')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submission_id)
      .eq('is_valid', true);
    await supabase.from('submissions').update({ view_count: count || 0 }).eq('id', submission_id);
    res.json({ ok: true, duplicate: !!insertError });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TEACHER AUTH CHECK ───
app.post('/api/teacher/login', async (req, res) => {
  try {
    const invite_code = normalizeInviteCode(req.body.invite_code);
    const password = String(req.body.password ?? '');
    const { data, error } = await supabase.from('activities')
      .select('*').eq('invite_code', invite_code).single();
    if (error || !data) return res.status(404).json({ error: 'Activity not found' });
    if (data.teacher_password !== password) return res.status(403).json({ error: 'Wrong password' });
    const token = makeTeacherToken(data.id);
    res.json({ activity: sanitizeActivity(data), token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CSV EXPORT ───
app.get('/api/teacher/export', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: act } = await supabase.from('activities').select('*').eq('id', activity_id).single();
    const { data } = await supabase.from('submissions')
      .select('*, users(name, student_id, class_name, group_name)')
      .eq('activity_id', activity_id).order('rank', { ascending: true });
    const BOM = '\uFEFF';
    let csv = BOM + '排名,匿名编号,学生姓名,学号,班级,小组,作品标题,上传时间,浏览量,评分人数,平均分,综合分,教师评分,最终成绩\n';
    (data || []).forEach((s, i) => {
      const u = s.users || {};
      csv += `${i+1},${s.anonymous_code},${u.name||''},${u.student_id||''},${u.class_name||''},${u.group_name||''},${s.title},${formatAppTimestampCN(new Date(s.upload_time))},${s.view_count},${s.rating_count},${s.average_rating},${s.composite_score},${s.teacher_score||''},${s.final_score||''}\n`;
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=classshow_export.csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ZIP EXPORT ───
app.get('/api/teacher/export-zip', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: act } = await supabase.from('activities').select('*').eq('id', activity_id).single();
    
    const { data: subs } = await supabase.from('submissions')
      .select('*, users(name, student_id, class_name)')
      .eq('activity_id', activity_id);
      
    if (!subs || subs.length === 0) return res.status(404).json({ error: 'No submissions found' });
    const mergedSubs = await enrichSubmissionMediaRows(subs);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(act.activity_name)}_works.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Download images from Supabase and append to ZIP
    for (const s of mergedSubs) {
      const sourceUrl = resolveSubmissionMediaUrl(s);
      if (sourceUrl) {
        try {
          const buffer = await downloadRemoteBuffer(sourceUrl);
            const u = s.users || {};
            const ext = s.media_type === 'video'
              ? 'mp4'
              : guessUploadExtension({ originalname: s.storage_path || sourceUrl || s.image_url }, 'jpg');
            // 鏍煎紡: 鐝骇_瀛﹀彿_濮撳悕_鏍囬.jpg
            const safeTitle = s.title.replace(/[\/\?<>\\:\*\|":]/g, '');
            const filename = `${u.class_name||'鏈煡鐝骇'}_${u.student_id||'鏈煡瀛﹀彿'}_${u.name||'鏈煡濮撳悕'}_${safeTitle}.${ext}`;
            archive.append(buffer, { name: filename });
        } catch (err) { console.error('Error downloading image for zip:', sourceUrl, err); }
      }
    }
    await archive.finalize();
  } catch (e) { 
    if (!res.headersSent) res.status(500).json({ error: e.message }); 
  }
});

// ─── ACTIVITY STATS ───
app.get('/api/teacher/dashboard-summary', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const [
      activityResult,
      usersResult,
      subsResult,
      ratingsCountResult,
      commentsResult,
      rosterResult,
      storageSummary,
      latestFeedback,
      hotFeedback
    ] = await Promise.all([
      fetchActivityById(activity_id),
      supabase.from('users')
        .select('id,name,student_id,class_name,group_name')
        .eq('activity_id', activity_id),
      supabase.from('submissions')
        .select('id,title,description,image_url,storage_path,media_type,media_size,upload_time,view_count,rating_count,average_rating,composite_score,is_pinned,is_teacher_selected,user_id,users(name,student_id,class_name,group_name)')
        .eq('activity_id', activity_id)
        .eq('status', 'visible'),
      supabase.from('ratings')
        .select('id', { count: 'exact', head: true })
        .eq('activity_id', activity_id),
      supabase.from('comments')
        .select('id,submission_id,user_id,content,created_at')
        .eq('activity_id', activity_id),
      supabase.from('student_roster')
        .select('id,student_id,name,active,feedback_muted')
        .eq('activity_id', activity_id)
        .order('student_id', { ascending: true }),
      buildStorageSummary(activity_id),
      listActivityFeedback({ activityId: activity_id, sort: 'latest', includeUsers: true, limit: 5 }).catch(() => ({ likes_enabled: false, items: [] })),
      listActivityFeedback({ activityId: activity_id, sort: 'hot', includeUsers: true, limit: 5 }).catch(() => ({ likes_enabled: false, items: [] }))
    ]);

    if (activityResult.error) throw activityResult.error;
    if (usersResult.error) throw usersResult.error;
    if (subsResult.error) throw subsResult.error;
    if (ratingsCountResult.error) throw ratingsCountResult.error;
    if (commentsResult.error && !/comments|does not exist|schema cache/i.test(commentsResult.error.message || '')) {
      throw commentsResult.error;
    }

    let rosterRows = [];
    let rosterReady = true;
    if (rosterResult.error && /student_roster|schema cache/i.test(rosterResult.error.message || '')) {
      rosterReady = false;
    } else if (rosterResult.error) {
      throw rosterResult.error;
    } else {
      rosterRows = rosterResult.data || [];
    }

    let feedbackLikeCount = 0;
    let feedbackLikesEnabled = false;
    try {
      const { count, error } = await supabase.from('activity_feedback_likes')
        .select('id', { count: 'exact', head: true })
        .eq('activity_id', activity_id);
      if (!error) {
        feedbackLikeCount = count || 0;
        feedbackLikesEnabled = true;
      }
    } catch {}

    const users = usersResult.data || [];
    const submissions = await enrichSubmissionMediaRows((subsResult.data || []).map(item => ({
      ...item,
      media_size: Number(item.media_size) || 0,
      view_count: Number(item.view_count) || 0,
      rating_count: Number(item.rating_count) || 0,
      average_rating: Number(item.average_rating) || 0,
      composite_score: Number(item.composite_score) || 0
    })));
    const comments = commentsResult.data || [];
    const workComments = comments.filter(item => !!item.submission_id);
    const feedbackComments = comments.filter(item => !item.submission_id && !isWithdrawnFeedbackContent(item.content));
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sevenDayMs = 7 * oneDayMs;
    const totalViews = submissions.reduce((sum, item) => sum + item.view_count, 0);
    const imageCount = submissions.filter(item => (item.media_type || 'image') !== 'video').length;
    const videoCount = submissions.filter(item => item.media_type === 'video').length;
    const creatorCount = new Set(submissions.map(item => String(item.user_id || '')).filter(Boolean)).size;
    const uploads24h = submissions.filter(item => now - new Date(item.upload_time).getTime() <= oneDayMs).length;
    const uploads7d = submissions.filter(item => now - new Date(item.upload_time).getTime() <= sevenDayMs).length;
    const ratedWorks = submissions.filter(item => item.rating_count > 0);
    const averageScore = ratedWorks.length
      ? ratedWorks.reduce((sum, item) => sum + item.average_rating, 0) / ratedWorks.length
      : 0;
    const averageRatingsPerWork = submissions.length
      ? (ratingsCountResult.count || 0) / submissions.length
      : 0;
    const activeRosterRows = rosterRows.filter(item => item.active !== false);
    const mutedRosterRows = rosterRows.filter(item => item.feedback_muted);
    const archivePolicy = resolveActivityArchivePolicy(activityResult.data);
    const archiveProvider = getArchiveProviderInfo(archivePolicy);
    const archiveCutoffIso = getArchiveCutoffIso(archivePolicy.after_days);
    const mediaPipeline = submissions.reduce((acc, item) => {
      if (item.media_type === 'video') {
        acc.video_total += 1;
        acc.transcode[item.transcode_status || 'ready'] = (acc.transcode[item.transcode_status || 'ready'] || 0) + 1;
      }
      if (item.thumbnail_url) acc.thumbnail_ready += 1;
      else acc.thumbnail_missing += 1;
      const archiveStatus = item.archive_status || (archiveProvider.configured ? 'pending' : 'disabled');
      acc.archive[archiveStatus] = (acc.archive[archiveStatus] || 0) + 1;
      if (archiveCutoffIso && new Date(item.upload_time).getTime() <= new Date(archiveCutoffIso).getTime() && !['mirrored', 'cold'].includes(archiveStatus)) {
        acc.archive_eligible += 1;
      }
      return acc;
    }, {
      video_total: 0,
      thumbnail_ready: 0,
      thumbnail_missing: 0,
      archive_eligible: 0,
      transcode: { ready: 0, pending: 0, processing: 0, retry: 0, failed: 0 },
      archive: { disabled: 0, pending: 0, processing: 0, mirrored: 0, cold: 0, failed: 0 }
    });

    const topRated = submissions
      .slice()
      .sort((a, b) => {
        if (b.average_rating !== a.average_rating) return b.average_rating - a.average_rating;
        if (b.rating_count !== a.rating_count) return b.rating_count - a.rating_count;
        return new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime();
      })
      .slice(0, 6);
    const mostViewed = submissions
      .slice()
      .sort((a, b) => {
        if (b.view_count !== a.view_count) return b.view_count - a.view_count;
        return new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime();
      })
      .slice(0, 6);
    const recentUploads = submissions
      .slice()
      .sort((a, b) => new Date(b.upload_time).getTime() - new Date(a.upload_time).getTime())
      .slice(0, 8);
    const missingMedia = buildMissingMediaReport(submissions, storageSummary);
    const snapshotOverview = await listArchiveSnapshots(activity_id, { provider: archiveProvider }).catch(error => ({
      provider: archiveProvider,
      items: [],
      error: String(error?.message || error || 'Failed to list snapshots'),
      cache_ttl_ms: OPS_SNAPSHOT_LIST_TTL_MS
    }));

    res.json({
      activity: sanitizeActivity(activityResult.data),
      metrics: {
        participant_count: users.length,
        roster_count: activeRosterRows.length,
        creator_count: creatorCount,
        submission_count: submissions.length,
        image_count: imageCount,
        video_count: videoCount,
        rating_count: ratingsCountResult.count || 0,
        comment_count: workComments.length,
        feedback_count: feedbackComments.length,
        feedback_like_count: feedbackLikeCount,
        total_views: totalViews,
        average_score: Math.round(averageScore * 100) / 100,
        average_ratings_per_work: Math.round(averageRatingsPerWork * 100) / 100,
        uploads_24h: uploads24h,
        uploads_7d: uploads7d,
        feedback_muted_count: mutedRosterRows.length,
        roster_ready: rosterReady
      },
      storage: storageSummary,
      media_pipeline: {
        provider: archiveProvider,
        transcode: mediaPipeline.transcode,
        archive: mediaPipeline.archive,
        video_total: mediaPipeline.video_total,
        thumbnail_ready: mediaPipeline.thumbnail_ready,
        thumbnail_missing: mediaPipeline.thumbnail_missing,
        archive_eligible: mediaPipeline.archive_eligible
      },
      roster: {
        ready: rosterReady,
        items: rosterRows,
        active_count: activeRosterRows.length,
        muted_count: mutedRosterRows.length,
        coverage_percent: activeRosterRows.length > 0
          ? Math.round((creatorCount / activeRosterRows.length) * 100)
          : 0
      },
      top_rated: topRated,
      most_viewed: mostViewed,
      recent_uploads: recentUploads,
      missing_media: missingMedia,
      ops: {
        server_time: new Date().toISOString(),
        tasks: buildTaskOpsOverview(),
        snapshots: snapshotOverview
      },
      latest_feedback: latestFeedback.items || [],
      hot_feedback: hotFeedback.items || [],
      feedback_likes_enabled: !!(latestFeedback.likes_enabled || hotFeedback.likes_enabled || feedbackLikesEnabled)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/teacher/storage-cleanup', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? req.query.activity_id ?? '').trim();
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const storageSummary = await buildStorageSummary(activity_id);
    const paths = storageSummary.orphan_files.map(item => item.path).filter(Boolean);
    if (!paths.length) {
      return res.json({ ok: true, removed: 0, bytes_freed: 0, summary: storageSummary });
    }

    let quarantined = 0;
    for (const filePath of paths) {
      if (await deleteStorageObject(filePath, { reason: 'teacher-orphan-cleanup' })) {
        quarantined += 1;
      }
    }

    res.json({
      ok: true,
      removed: quarantined,
      quarantined,
      bytes_freed: 0,
      bytes_quarantined: storageSummary.orphan_bytes,
      summary: storageSummary
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/teacher/transcode-run', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? req.query.activity_id ?? '').trim();
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const result = await processPendingVideoTranscodes({ activityId: activity_id, limit: TRANSCODE_BATCH_SIZE, ignoreMinAge: true, source: 'manual' });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/teacher/archive-run', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? req.query.activity_id ?? '').trim();
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const result = await processArchiveQueue({ activityId: activity_id, limit: ARCHIVE_BATCH_SIZE, source: 'manual' });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/teacher/backup-snapshot/export', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.query.activity_id ?? '').trim();
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const snapshot = await buildActivitySnapshot(activity_id);
    const snapshotId = formatSnapshotStamp(new Date(snapshot.generated_at || Date.now()));
    const { json, sha256 } = serializeActivitySnapshot({
      ...snapshot,
      snapshot_id: snapshotId
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${buildSnapshotDownloadFilename(snapshot.activity, snapshotId)}"`);
    res.setHeader('X-ClassShow-Snapshot-Sha256', sha256);
    res.send(json);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/teacher/backup-snapshot/archive', teacherAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? req.query.activity_id ?? '').trim();
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const snapshot = await buildActivitySnapshot(activity_id);
    const provider = getArchiveProviderInfo(resolveActivityArchivePolicy(snapshot.activity));
    if (!provider.configured) {
      return res.status(400).json({ error: 'Archive provider is not configured' });
    }

    const snapshotId = formatSnapshotStamp(new Date(snapshot.generated_at || Date.now()));
    const snapshotPayload = {
      ...snapshot,
      snapshot_id: snapshotId
    };
    const { json, sha256 } = serializeActivitySnapshot(snapshotPayload);
    const tempPath = createTempDerivedPath('json');
    try {
      await fs.promises.writeFile(tempPath, json, 'utf8');
      const objectKey = buildArchiveSnapshotObjectKey(snapshot.activity, snapshotId);
      const archived = await uploadLocalFileToArchiveObject(tempPath, objectKey, contentTypeForExtension('json'), provider);
      if (!archived) throw new Error('Snapshot archive upload failed');
      invalidateArchiveSnapshotListCache(activity_id);
      const snapshots = await listArchiveSnapshots(activity_id, { provider, force: true }).catch(() => ({ provider, items: [] }));
      res.json({
        ok: true,
        snapshot: {
          id: snapshotId,
          filename: buildSnapshotDownloadFilename(snapshot.activity, snapshotId),
          sha256,
          bytes: Buffer.byteLength(json, 'utf8'),
          generated_at: snapshot.generated_at,
          provider: archived.provider,
          key: archived.key,
          url: archived.url || null,
          view_url: archived.view_url || null
        },
        snapshots
      });
    } finally {
      await safeUnlink(tempPath);
    }
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/activities/:id/stats', async (req, res) => {
  try {
    const id = req.params.id;
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('activity_id', id);
    const { count: subCount } = await supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('activity_id', id);
    const { count: ratingCount } = await supabase.from('ratings').select('*', { count: 'exact', head: true }).eq('activity_id', id);
    res.json({ users: userCount || 0, submissions: subCount || 0, ratings: ratingCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/qrcode', async (req, res) => {
  try {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const url = await QRCode.toDataURL(text, { width: 300, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`ClassShow running on port ${PORT}`));

