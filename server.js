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

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

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

function normalizeInviteCode(input) {
  return String(input ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

function sanitizeActivity(activity) {
  if (!activity) return activity;
  const { teacher_password, ...safe } = activity;
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
  if (!/^(uploads|videos)\/[A-Za-z0-9._-]+$/.test(value)) return null;
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

async function deleteStorageObject(storagePath) {
  const safePath = sanitizeStoragePath(storagePath);
  if (!safePath) return false;
  const { error } = await supabase.storage.from('submissions').remove([safePath]);
  if (error) {
    console.warn('Failed to delete storage object:', safePath, error.message);
    return false;
  }
  return true;
}

async function deleteSubmissionMedia(submission) {
  if (!submission) return false;
  const storagePath = sanitizeStoragePath(submission.storage_path) || storagePathFromPublicUrl(submission.image_url);
  return deleteStorageObject(storagePath);
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

async function fetchActivityByCode(code) {
  const normalized = normalizeInviteCode(code);
  const fields = 'id,course_name,class_name,activity_name,description,invite_code,upload_open,voting_open,comments_open,show_live_ranking,roster_enabled,pin_required,created_at';
  let result = await supabase.from('activities').select(fields).eq('invite_code', normalized).single();
  if (result.error && /roster_enabled|pin_required|comments_open/i.test(result.error.message || '')) {
    result = await supabase.from('activities')
      .select('id,course_name,class_name,activity_name,description,invite_code,upload_open,voting_open,comments_open,show_live_ranking,created_at')
      .eq('invite_code', normalized).single();
  }
  if (result.data) {
    result.data.roster_enabled = !!result.data.roster_enabled;
    result.data.pin_required = !!result.data.pin_required;
  }
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

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
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

    const allowed = ['upload_open', 'voting_open', 'comments_open', 'show_live_ranking', 'roster_enabled', 'pin_required', 'description', 'activity_name'];
    const payload = {};
    for (const key of allowed) {
      if (!(key in req.body)) continue;
      if (key === 'description') payload[key] = sanitizeText(req.body[key], 500);
      else if (key === 'activity_name') payload[key] = sanitizeText(req.body[key], 120);
      else payload[key] = coerceBoolean(req.body[key]);
    }

    const { data, error } = await supabase.from('activities').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(sanitizeActivity(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    rows = await readXlsxFile(file.buffer);
  } else {
    const err = new Error('Only .xlsx and .csv roster files are supported');
    err.status = 400;
    throw err;
  }
  return normalizeRosterRows(rows, defaultClassName);
}

app.get('/api/teacher/roster', teacherAuth, async (req, res) => {
  try {
    const { activity_id } = req.query;
    if (!activity_id) return res.status(400).json({ error: 'Missing activity_id' });
    const auth = await ensureTeacherCanAccessActivity(req, activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data, error } = await supabase.from('student_roster')
      .select('id,student_id,name,class_name,group_name,active,created_at')
      .eq('activity_id', activity_id)
      .order('student_id', { ascending: true });
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
    const status = e.status || (/student_roster|pin_hash|pin_salt|constraint|conflict|roster_enabled|pin_required/i.test(e.message || '') ? 500 : 500);
    const message = status === 500 && /student_roster|pin_hash|pin_salt|constraint|conflict|roster_enabled|pin_required/i.test(e.message || '')
      ? 'Student roster schema is not ready. Run upgrade_v4.sql first.'
      : e.message;
    res.status(status).json({ error: message });
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
    const status = e.status || (/student_roster|pin_hash|pin_salt|constraint|conflict|roster_enabled|pin_required/i.test(e.message || '') ? 500 : 500);
    const message = status === 500 && /student_roster|pin_hash|pin_salt|constraint|conflict|roster_enabled|pin_required/i.test(e.message || '')
      ? 'Student roster schema is not ready. Run upgrade_v4.sql first.'
      : e.message;
    res.status(status).json({ error: message });
  }
});

// ─── MEDIA UPLOAD (image + video) ───
app.post('/api/upload', upload.single('image'), async (req, res) => {
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

    const isVideo = req.file.mimetype.startsWith('video/');
    const ext = req.file.originalname.split('.').pop().toLowerCase() || (isVideo ? 'mp4' : 'jpg');
    const folder = isVideo ? 'videos' : 'uploads';
    const filename = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    
    const fileStream = fs.createReadStream(req.file.path);
    const { error } = await supabase.storage.from('submissions').upload(filename, fileStream, {
      contentType: req.file.mimetype, upsert: false, duplex: 'half'
    });
    
    // Clean up temp file
    fs.unlink(req.file.path, () => {});
    
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('submissions').getPublicUrl(filename);
    res.json({
      url: urlData.publicUrl,
      path: filename,
      type: isVideo ? 'video' : 'image',
      size: req.file.size
    });
  } catch (e) { 
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: e.message }); 
  }
});

// ─── SUBMISSIONS ───
app.post('/api/submissions', studentAuth, async (req, res) => {
  try {
    const activity_id = String(req.body.activity_id ?? '').trim();
    const user_id = String(req.body.user_id ?? '').trim();
    const title = sanitizeText(req.body.title, 140);
    const description = sanitizeText(req.body.description, 400);
    const storage_path = sanitizeStoragePath(req.body.storage_path) || storagePathFromPublicUrl(req.body.image_url);
    const image_url = publicUrlForStoragePath(storage_path);
    const media_type = isVideoFilePath(storage_path) ? 'video' : 'image';
    const media_size = Number.isFinite(Number(req.body.media_size)) ? Number(req.body.media_size) : null;
    if (!activity_id || !user_id || !title || !storage_path || !image_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already submitted (allow re-upload)
    const { data: existing } = await supabase.from('submissions')
      .select('*').eq('activity_id', activity_id).eq('user_id', user_id).single();
    if (existing) {
      const payload = {
        title, description, image_url, storage_path, media_type, media_size, last_modified_time: new Date().toISOString(),
        edit_count: existing.edit_count + 1
      };
      let { data, error } = await supabase.from('submissions').update(payload).eq('id', existing.id).select().single();
      if (error && /storage_path|media_type|media_size/i.test(error.message || '')) {
        const legacyPayload = { ...payload };
        delete legacyPayload.storage_path;
        delete legacyPayload.media_type;
        delete legacyPayload.media_size;
        ({ data, error } = await supabase.from('submissions').update(legacyPayload).eq('id', existing.id).select().single());
      }
      if (error) throw error;
      const oldStoragePath = sanitizeStoragePath(existing.storage_path) || storagePathFromPublicUrl(existing.image_url);
      if (oldStoragePath && oldStoragePath !== storage_path) {
        await deleteStorageObject(oldStoragePath);
      }
      return res.json(data);
    }
    // Generate anonymous code
    const { count } = await supabase.from('submissions').select('*', { count: 'exact', head: true }).eq('activity_id', activity_id);
    const code = `A${String((count || 0) + 1).padStart(3, '0')}`;
    const insertPayload = { activity_id, user_id, anonymous_code: code, title, description, image_url, storage_path, media_type, media_size };
    let { data, error } = await supabase.from('submissions').insert([insertPayload]).select().single();
    if (error && /storage_path|media_type|media_size/i.test(error.message || '')) {
      const legacyPayload = { ...insertPayload };
      delete legacyPayload.storage_path;
      delete legacyPayload.media_type;
      delete legacyPayload.media_size;
      ({ data, error } = await supabase.from('submissions').insert([legacyPayload]).select().single());
    }
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

    const [subsResult, commentsResult] = await Promise.all([
      supabase.from('submissions')
        .select('id,anonymous_code,title,description,image_url,upload_time,view_count,rating_count,average_rating,composite_score,is_pinned,is_teacher_selected,status,user_id')
        .eq('activity_id', activity_id).eq('status', 'visible')
        .order('upload_time', { ascending: false }),
      supabase.from('comments').select('submission_id').eq('activity_id', activity_id)
    ]);
    if (subsResult.error) throw subsResult.error;
    // Build comment count map from live data
    const ccMap = {};
    (commentsResult.data || []).forEach(c => { ccMap[c.submission_id] = (ccMap[c.submission_id] || 0) + 1; });
    const result = (subsResult.data || []).map(s => {
      const is_owner = !!viewerUserId && String(s.user_id) === viewerUserId;
      const { user_id, ...safe } = s;
      return { ...safe, image_url: sanitizeMediaUrl(safe.image_url) || '', is_owner, comment_count: ccMap[s.id] || 0 };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/submissions/:id', async (req, res) => {
  try {
    const { viewer_user_id } = req.query;
    const [subResult, commentsResult] = await Promise.all([
      supabase.from('submissions')
        .select('id,anonymous_code,title,description,image_url,upload_time,view_count,rating_count,average_rating,user_id,activity_id')
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
    res.json({ ...safe, image_url: sanitizeMediaUrl(safe.image_url) || '', is_owner, comment_count: commentsResult.count || 0 });
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
    const result = (subsResult.data || []).map(s => ({ ...s, image_url: sanitizeMediaUrl(s.image_url) || '', comment_count: ccMap[s.id] || 0 }));
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
    const { data: sub, error: subErr } = await supabase.from('submissions')
      .select('id, activity_id')
      .eq('id', req.params.id)
      .single();
    if (subErr || !sub) return res.status(404).json({ error: 'Submission not found' });

    const auth = await ensureTeacherCanAccessActivity(req, sub.activity_id);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    await supabase.from('submissions').delete().eq('id', req.params.id);
    await deleteSubmissionMedia(sub);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const { data: sub } = await supabase.from('submissions').select('id, activity_id').eq('id', submission_id).single();
    if (!sub || String(sub.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Submission/activity mismatch' });
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

    const { data: sub } = await supabase.from('submissions').select('id,activity_id,view_count').eq('id', submission_id).single();
    if (!sub || String(sub.activity_id) !== String(activity_id)) {
      return res.status(400).json({ error: 'Submission/activity mismatch' });
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
      csv += `${i+1},${s.anonymous_code},${u.name||''},${u.student_id||''},${u.class_name||''},${u.group_name||''},${s.title},${s.upload_time},${s.view_count},${s.rating_count},${s.average_rating},${s.composite_score},${s.teacher_score||''},${s.final_score||''}\n`;
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

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(act.activity_name)}_works.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Download images from Supabase and append to ZIP
    for (const s of subs) {
      if (s.image_url) {
        try {
          const response = await fetch(s.image_url);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            const u = s.users || {};
            const ext = s.image_url.split('.').pop()?.split('?')[0] || 'jpg';
            // 鏍煎紡: 鐝骇_瀛﹀彿_濮撳悕_鏍囬.jpg
            const safeTitle = s.title.replace(/[\/\?<>\\:\*\|":]/g, '');
            const filename = `${u.class_name||'鏈煡鐝骇'}_${u.student_id||'鏈煡瀛﹀彿'}_${u.name||'鏈煡濮撳悕'}_${safeTitle}.${ext}`;
            archive.append(Buffer.from(buffer), { name: filename });
          }
        } catch (err) { console.error('Error downloading image for zip:', s.image_url, err); }
      }
    }
    await archive.finalize();
  } catch (e) { 
    if (!res.headersSent) res.status(500).json({ error: e.message }); 
  }
});

// ─── ACTIVITY STATS ───
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

