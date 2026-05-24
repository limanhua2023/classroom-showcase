const API = (window.ClassShowAppConfig && window.ClassShowAppConfig.apiBase) || '/api';
const APP_TIME_ZONE = 'Asia/Bangkok';

function resolveApiUrl(path = '') {
  if (typeof window.classShowApiUrl === 'function') {
    return window.classShowApiUrl(path);
  }
  return API + path;
}

async function readApiErrorMessage(res, fallback = '') {
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await res.json().catch(() => ({}));
    const message =
      payload?.error
      || payload?.detail
      || payload?.message
      || payload?.hint
      || fallback
      || res.statusText
      || 'Request failed';
    if (payload?.error && payload?.detail && payload.detail !== payload.error) {
      return `${payload.error}: ${payload.detail}`;
    }
    return message;
  }
  const text = await res.text().catch(() => '');
  return text || fallback || res.statusText || 'Request failed';
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const teacherToken = sessionStorage.getItem('teacherToken');
  if (teacherToken) headers['x-teacher-auth'] = teacherToken;
  const superAdminToken = sessionStorage.getItem('superAdminToken');
  if (superAdminToken) headers['x-super-admin-auth'] = superAdminToken;

  const sessionRaw = sessionStorage.getItem('classshow_user');
  if (sessionRaw) {
    try {
      const user = JSON.parse(sessionRaw);
      if (user?.token) headers['x-user-token'] = user.token;
    } catch {}
  }

  const res = await fetch(resolveApiUrl(path), { ...opts, headers });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res));
  }
  if (res.headers.get('content-type')?.includes('text/csv')) return res.blob();
  return res.json();
}

async function uploadMedia(file) {
  const fd = new FormData();
  const user = getSession();
  const activityId = getActivityId();
  if (!user?.id || !activityId) throw new Error('会话已失效，请重新登录');

  fd.append('image', file);
  fd.append('user_id', user.id);
  fd.append('activity_id', activityId);

  const headers = {};
  if (user.token) headers['x-user-token'] = user.token;

  const res = await fetch(resolveApiUrl('/upload'), { method: 'POST', body: fd, headers });
  if (!res.ok) {
    throw new Error(await readApiErrorMessage(res, '上传失败'));
  }
  return res.json();
}

async function uploadImage(file) {
  return uploadMedia(file);
}

function isVideo(url) {
  if (!url) return false;
  return /\.(mp4|webm|mov|ogg)$/i.test(String(url).split('?')[0]);
}

function getWorkMediaUrl(work) {
  return String(work?.image_url || '').trim();
}

function getWorkThumbnailUrl(work) {
  return String(work?.thumbnail_url || work?.poster_url || work?.image_url || '').trim();
}

function getWorkPosterUrl(work) {
  return String(work?.poster_url || work?.thumbnail_url || work?.image_url || '').trim();
}

function getTranscodeStatusLabel(status) {
  const value = String(status || 'ready').toLowerCase();
  if (value === 'pending') return '转码排队';
  if (value === 'processing') return '转码中';
  if (value === 'retry') return '等待重试';
  if (value === 'failed') return '转码失败';
  return '已优化';
}

function getArchiveStatusLabel(work) {
  const tier = String(work?.archive_tier || '').toLowerCase();
  const status = String(work?.archive_status || '').toLowerCase();
  if (tier === 'cold') return '冷归档';
  if (status === 'mirrored') return '已归档';
  if (status === 'processing') return '归档中';
  if (status === 'pending') return '待归档';
  if (status === 'failed') return '归档失败';
  return '';
}

function getSession() {
  const raw = sessionStorage.getItem('classshow_user');
  return raw ? JSON.parse(raw) : null;
}

function setSession(data) {
  sessionStorage.setItem('classshow_user', JSON.stringify(data));
}

function setGuestSession(activity) {
  sessionStorage.setItem('classshow_guest', '1');
  sessionStorage.setItem('classshow_activity_id', activity.id);
  sessionStorage.setItem('classshow_activity', JSON.stringify(activity));
}

function isGuest() {
  return sessionStorage.getItem('classshow_guest') === '1';
}

function getSessionOrGuest() {
  return getSession() || (isGuest() ? { id: null, name: '访客', _guest: true } : null);
}

function getActivityId() {
  return sessionStorage.getItem('classshow_activity_id');
}

function setActivityId(id) {
  sessionStorage.setItem('classshow_activity_id', id);
}

function setPostLoginTarget(path) {
  if (path) sessionStorage.setItem('classshow_post_login_target', String(path));
  else sessionStorage.removeItem('classshow_post_login_target');
}

function getPostLoginTarget() {
  return sessionStorage.getItem('classshow_post_login_target') || '';
}

function clearPostLoginTarget() {
  sessionStorage.removeItem('classshow_post_login_target');
}

async function resolveCourseEntryPath(courseName) {
  const normalized = String(courseName || '').trim();
  if (!normalized) return '';
  try {
    const payload = await api('/portal/course-registry?course_name=' + encodeURIComponent(normalized));
    return String(payload?.course?.entry_path || '').trim();
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  return Math.floor(diff / 86400) + ' 天前';
}

function isNewWork(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) < 10 * 60 * 1000;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const fixed = size >= 100 || idx === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(fixed)} ${units[idx]}`;
}

function formatBangkokTime(value, options = {}) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: options.withSeconds === false ? undefined : '2-digit',
    hour12: false
  }).format(new Date(value));
}

function formatDateTime(value, options = {}) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: options.timeZone || APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: options.withSeconds === false ? undefined : '2-digit',
    hour12: false
  }).format(date).replace(',', '');
}

function buildCompressionNote(uploadResult) {
  if (!uploadResult) return '';
  const processing = !!uploadResult.processing || ['pending', 'processing', 'retry'].includes(String(uploadResult.transcode_status || '').toLowerCase());
  if (!uploadResult.compressed) {
    return processing ? '文件已上传，视频课堂优化版正在后台生成。' : '已按原文件保留';
  }
  const savedBytes = Number(uploadResult.saved_bytes) || 0;
  const savedPercent = Number(uploadResult.saved_percent) || 0;
  if (processing) {
    return `已完成首轮压缩，节省 ${formatBytes(savedBytes)}（${savedPercent}%），视频高清版会继续在后台转码。`;
  }
  return `已自动压缩，节省 ${formatBytes(savedBytes)}（${savedPercent}%）`;
}

function pickWorkTemplate(seedValue) {
  const source = String(seedValue ?? '');
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  const variants = ['aurora', 'gallery', 'signal', 'studio'];
  return variants[Math.abs(hash) % variants.length];
}
