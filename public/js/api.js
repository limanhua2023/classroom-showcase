// ClassShow API Helper
const API = '/api';

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const token = sessionStorage.getItem('teacherToken');
  if (token) headers['x-teacher-auth'] = token;
  
  const sStr = sessionStorage.getItem('classshow_user');
  if (sStr) {
    try {
      const sUser = JSON.parse(sStr);
      if (sUser && sUser.token) headers['x-user-token'] = sUser.token;
    } catch (e) {}
  }
  
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  if (res.headers.get('content-type')?.includes('text/csv')) return res.blob();
  return res.json();
}

// Upload any media file (image or video)
async function uploadMedia(file) {
  const fd = new FormData();
  const user = getSession();
  const actId = getActivityId();
  if (!user?.id || !actId) throw new Error('Missing session info, please login again');
  fd.append('image', file); // field name kept as 'image' for multer compat
  fd.append('user_id', user.id);
  fd.append('activity_id', actId);

  const headers = {};
  if (user.token) headers['x-user-token'] = user.token;
  const res = await fetch(API + '/upload', { method: 'POST', body: fd, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload failed'); }
  return res.json(); // { url, type: 'image'|'video' }
}

// Alias for backward compat
async function uploadImage(file) { return uploadMedia(file); }

// Helper: check if a URL is a video
function isVideo(url) {
  if (!url) return false;
  return /\.(mp4|webm|mov|ogg)$/i.test(url.split('?')[0]);
}

function getSession() {
  const s = sessionStorage.getItem('classshow_user');
  return s ? JSON.parse(s) : null;
}

function setSession(data) { sessionStorage.setItem('classshow_user', JSON.stringify(data)); }

// Guest session (read-only visitor, no rating/commenting)
function setGuestSession(activity) {
  sessionStorage.setItem('classshow_guest', '1');
  sessionStorage.setItem('classshow_activity_id', activity.id);
  sessionStorage.setItem('classshow_activity', JSON.stringify(activity));
}
function isGuest() { return sessionStorage.getItem('classshow_guest') === '1'; }
// Allow gallery/detail to accept either a real user OR guest mode
function getSessionOrGuest() { return getSession() || (isGuest() ? { id: null, name: '访客', _guest: true } : null); }

function getActivityId() { return sessionStorage.getItem('classshow_activity_id'); }
function setActivityId(id) { sessionStorage.setItem('classshow_activity_id', id); }

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  return Math.floor(diff / 86400) + '天前';
}

function isNewWork(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) < 5 * 60 * 1000;
}
