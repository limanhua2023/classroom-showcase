const DEFAULT_BASE_URL = 'https://classroom-showcase.onrender.com';
const COURSE_NAME = '经济学基础课程';
const COURSE_SLUG = 'economics-fundamentals';

function normalizeBaseUrl(input) {
  const value = String(input || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return value || DEFAULT_BASE_URL;
}

function formatStatus(ok) {
  return ok ? 'PASS' : 'FAIL';
}

function marker(ok) {
  return ok ? 'OK' : 'XX';
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

async function runAudit(baseUrl) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  try {
    const { response, json } = await fetchJson(`${baseUrl}/api/health`);
    const ok = response.ok && json?.service === 'classshow' && json?.supabase_configured === true;
    add('API health', ok, `HTTP ${response.status}; env=${json?.environment || '-'}; supabase=${json?.supabase_configured}`);
  } catch (error) {
    add('API health', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${baseUrl}/index.html`);
    add('Student portal shell', response.ok && text.includes('经济学基础'), `HTTP ${response.status}`);
  } catch (error) {
    add('Student portal shell', false, error.message);
  }

  try {
    const encoded = encodeURIComponent(COURSE_NAME);
    const { response, text } = await fetchText(`${baseUrl}/course.html?course=${encoded}`);
    add('Course portal shell', response.ok && text.includes('经济学基础'), `HTTP ${response.status}`);
  } catch (error) {
    add('Course portal shell', false, error.message);
  }

  try {
    const { response, json } = await fetchJson(`${baseUrl}/api/portal/course-registry`);
    const econ = Array.isArray(json?.courses)
      ? json.courses.find(item => item?.slug === COURSE_SLUG)
      : null;
    const ok = response.ok
      && !!econ
      && econ.is_active !== false
      && econ.entry_path === '/courses/economics-fundamentals/';
    add('Course registry entry', ok, econ ? `HTTP ${response.status}; active=${econ.is_active !== false}; path=${econ.entry_path}` : `HTTP ${response.status}; economics missing`);
  } catch (error) {
    add('Course registry entry', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${baseUrl}/courses/economics-fundamentals/`);
    const ok = response.ok && text.includes('经济学基础') && text.includes('economics-course-adapter.js');
    add('Dedicated economics page', ok, `HTTP ${response.status}`);
  } catch (error) {
    add('Dedicated economics page', false, error.message);
  }

  try {
    const response = await fetch(`${baseUrl}/economics`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/courses/economics-fundamentals/');
    add('Short alias /economics', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Short alias /economics', false, error.message);
  }

  try {
    const response = await fetch(`${baseUrl}/course/economics`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/course.html?course=');
    add('Short alias /course/economics', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Short alias /course/economics', false, error.message);
  }

  try {
    const response = await fetch(`${baseUrl}/teacher`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/teacher-login.html');
    add('Short alias /teacher', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Short alias /teacher', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${baseUrl}/teacher-dashboard.html`);
    add('Teacher dashboard shell', response.ok && text.includes('learningMonitorBadge'), `HTTP ${response.status}`);
  } catch (error) {
    add('Teacher dashboard shell', false, error.message);
  }

  try {
    const response = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
    const location = response.headers.get('location') || '';
    const ok = response.status >= 300 && response.status < 400 && location.includes('/super-admin.html');
    add('Short alias /admin', ok, `HTTP ${response.status}; location=${location || '-'}`);
  } catch (error) {
    add('Short alias /admin', false, error.message);
  }

  try {
    const { response, text } = await fetchText(`${baseUrl}/super-admin.html`);
    add('Super-admin shell', response.ok && text.includes('economics-fundamentals'), `HTTP ${response.status}`);
  } catch (error) {
    add('Super-admin shell', false, error.message);
  }

  return checks;
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2]);
  const checks = await runAudit(baseUrl);
  const failed = checks.filter(item => !item.ok);

  console.log(`Public readiness audit for ${baseUrl}`);
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
