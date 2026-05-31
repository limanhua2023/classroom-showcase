import { auditEconomicsStudentGate } from './check-economics-student-gate.mjs';

const DEFAULT_STUDENT_BASE_URL = 'https://classshow-student.pages.dev';
const DEFAULT_BACKEND_BASE_URL = 'https://classroom-showcase.onrender.com';
const COURSE_NAME = '经济学基础';
const COURSE_SLUG = 'economics-fundamentals';
const LEGACY_STUDENT_FORBIDDEN_MARKERS = [
  'teacher-login.html',
  'super-admin.html',
  'student-register.html?next=',
  'course.html?course='
];

function normalizeBaseUrl(input, fallback) {
  const value = String(input || fallback).trim().replace(/\/+$/, '');
  return value || fallback;
}

function formatStatus(ok) {
  return ok ? 'PASS' : 'FAIL';
}

function marker(ok) {
  return ok ? 'OK' : 'XX';
}

function includesNone(source, forbidden) {
  return forbidden.every(item => !source.includes(item));
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { response, text, json };
}

async function runAudit(studentBaseUrl, backendBaseUrl) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const encodedCourse = encodeURIComponent(COURSE_NAME);

  try {
    const result = await auditEconomicsStudentGate();
    add('Local economics student gate audit', true, result.detail || 'passed');
  } catch (error) {
    add('Local economics student gate audit', false, error.message);
  }

  try {
    const { response, json } = await fetchJson(`${backendBaseUrl}/api/health`);
    const ok = response.ok && json?.service === 'classshow' && json?.supabase_configured === true;
    add('Backend API health', ok, `HTTP ${response.status}; env=${json?.environment || '-'}; supabase=${json?.supabase_configured}`);
  } catch (error) {
    add('Backend API health', false, error.message);
  }

  try {
    const { response, json } = await fetchJson(`${backendBaseUrl}/api/portal/course-registry`);
    const econ = Array.isArray(json?.courses)
      ? json.courses.find(item => item?.slug === COURSE_SLUG)
      : null;
    const ok = response.ok
      && !!econ
      && econ.is_active !== false
      && econ.entry_path === '/courses/economics-fundamentals/';
    add('Backend course registry entry', ok, econ ? `HTTP ${response.status}; active=${econ.is_active !== false}; path=${econ.entry_path}` : `HTTP ${response.status}; economics missing`);
  } catch (error) {
    add('Backend course registry entry', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${backendBaseUrl}/teacher-login.html`);
    const ok = response.ok
      && text.includes('teacher-dashboard.html?setup=roster')
      && text.includes('Excel')
      && text.includes('名单');
    add('Backend teacher roster-first entry', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Backend teacher roster-first entry', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${backendBaseUrl}/teacher-dashboard.html`);
    add('Backend teacher dashboard shell', response.ok && text.includes('learningMonitorBadge'), `HTTP ${response.status}`);
  } catch (error) {
    add('Backend teacher dashboard shell', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${backendBaseUrl}/teacher-dashboard.html`);
    const ok = response.ok
      && text.includes('learningEvidenceSearchInput')
      && text.includes('learningEvidenceQuickStats')
      && text.includes('learningEvidenceResetBtn')
      && text.includes('data-learning-evidence-filter="recent24h"')
      && text.includes('rosterGateBanner')
      && text.includes('classshowBaseReloadDashboard')
      && text.includes('rosterReusePanel')
      && text.includes('loadRosterReuseSources');
    add('Backend teacher evidence tools', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Backend teacher evidence tools', false, error.message);
  }

  try {
    const response = await fetch(`${backendBaseUrl}/teacher`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/teacher-login.html');
    add('Backend short alias /teacher', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Backend short alias /teacher', false, error.message);
  }

  try {
    const response = await fetch(`${backendBaseUrl}/admin`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/super-admin.html');
    add('Backend short alias /admin', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Backend short alias /admin', false, error.message);
  }

  try {
    const response = await fetch(`${backendBaseUrl}/api/health`, {
      headers: { Origin: studentBaseUrl }
    });
    const allowOrigin = response.headers.get('access-control-allow-origin') || '';
    const ok = response.ok && allowOrigin === studentBaseUrl;
    add('Backend CORS allows student origin', ok, `HTTP ${response.status}; allow-origin=${allowOrigin || '-'}`);
  } catch (error) {
    add('Backend CORS allows student origin', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${studentBaseUrl}/index.html`);
    const ok = response.ok
      && text.includes('student-entry-redirect.js')
      && includesNone(text, LEGACY_STUDENT_FORBIDDEN_MARKERS);
    add('Student legacy index redirects cleanly', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Student legacy index redirects cleanly', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${studentBaseUrl}/course.html?course=${encodedCourse}`);
    const ok = response.ok
      && text.includes('student-entry-redirect.js')
      && includesNone(text, LEGACY_STUDENT_FORBIDDEN_MARKERS);
    add('Student legacy course page redirects cleanly', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Student legacy course page redirects cleanly', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${studentBaseUrl}/student-register.html?next=%2Fcourses%2Feconomics-fundamentals%2F`);
    const ok = response.ok
      && text.includes('student-entry-redirect.js')
      && text.includes('studentRedirectLink')
      && !text.includes('teacher-login.html');
    add('Student legacy register redirects cleanly', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Student legacy register redirects cleanly', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${studentBaseUrl}/student-entry`);
    const ok = response.ok
      && text.includes('studentEnter(event)')
      && text.includes('normalizeRequestedEntryPath')
      && !text.includes('teacher-login.html')
      && !text.includes('super-admin.html');
    add('Student simplified entry page', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Student simplified entry page', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${studentBaseUrl}/courses/economics-fundamentals/`);
    const ok = response.ok
      && text.includes('economics-course-adapter.js')
      && text.includes('deployment-config.js')
      && !text.includes('进入教师模式')
      && !text.includes('id="teacher-btn"')
      && !text.includes("params.get('teacher')");
    add('Student dedicated economics page', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Student dedicated economics page', false, error.message);
  }

  try {
    const response = await fetch(`${studentBaseUrl}/student`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/student-entry');
    add('Student short alias /student', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Student short alias /student', false, error.message);
  }

  try {
    const response = await fetch(`${studentBaseUrl}/economics`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/courses/economics-fundamentals/');
    add('Student short alias /economics', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Student short alias /economics', false, error.message);
  }

  try {
    const response = await fetch(`${studentBaseUrl}/course/economics`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/courses/economics-fundamentals/');
    add('Student short alias /course/economics', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Student short alias /course/economics', false, error.message);
  }

  try {
    const response = await fetch(`${studentBaseUrl}/teacher`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('classroom-showcase.onrender.com/teacher');
    add('Student site /teacher redirects to backend', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Student site /teacher redirects to backend', false, error.message);
  }

  try {
    const response = await fetch(`${studentBaseUrl}/admin`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('classroom-showcase.onrender.com/admin');
    add('Student site /admin redirects to backend', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Student site /admin redirects to backend', false, error.message);
  }

  return checks;
}

async function main() {
  const studentBaseUrl = normalizeBaseUrl(process.argv[2], DEFAULT_STUDENT_BASE_URL);
  const backendBaseUrl = normalizeBaseUrl(process.argv[3], DEFAULT_BACKEND_BASE_URL);
  const checks = await runAudit(studentBaseUrl, backendBaseUrl);
  const failed = checks.filter(item => !item.ok);

  console.log('Public readiness audit');
  console.log(`  student: ${studentBaseUrl}`);
  console.log(`  backend: ${backendBaseUrl}`);
  for (const check of checks) {
    console.log(`${marker(check.ok)} ${check.name}: ${formatStatus(check.ok)} - ${check.detail}`);
  }
  console.log(`Summary: ${checks.length - failed.length}/${checks.length} passed.`);

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
