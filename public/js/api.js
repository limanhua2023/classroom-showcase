// ClassShow API Helper
const API = '/api';

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const token = sessionStorage.getItem('teacherToken');
  if (token) headers['x-teacher-auth'] = token;
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  if (res.headers.get('content-type')?.includes('text/csv')) return res.blob();
  return res.json();
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await fetch(API + '/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

function getSession() {
  const s = sessionStorage.getItem('classshow_user');
  return s ? JSON.parse(s) : null;
}

function setSession(data) { sessionStorage.setItem('classshow_user', JSON.stringify(data)); }
function getActivityId() { return sessionStorage.getItem('classshow_activity_id'); }
function setActivityId(id) { sessionStorage.setItem('classshow_activity_id', id); }

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
