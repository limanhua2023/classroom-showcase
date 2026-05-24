import fs from 'node:fs/promises';
import path from 'node:path';

const STUDENT_BASE = (process.env.CLASSSHOW_STUDENT_BASE || 'https://classshow-student.pages.dev').replace(/\/$/, '');
const BACKEND_BASE = (process.env.CLASSSHOW_BACKEND_BASE || 'https://classroom-showcase.onrender.com').replace(/\/$/, '');
const COURSE_NAME = '经济学基础课程';
const COURSE_SLUG = 'economics-fundamentals';

function fail(message) {
  throw new Error(message);
}

async function api(base, pathname, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(`${base}${pathname}`, { ...options, headers });
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => '');
  if (!res.ok) {
    const detail = typeof body === 'string' ? body : body?.error || body?.message || JSON.stringify(body);
    fail(`${options.method || 'GET'} ${pathname} failed: ${res.status} ${detail}`);
  }
  return body;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeInviteCode() {
  return `AUTO${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function makeTeacherPassword() {
  return `auto-${Math.random().toString(36).slice(2, 10)}!`;
}

async function checkSourceGuard() {
  const files = [
    'public/student-gallery.html',
    'public/student-upload.html',
    'public/student-detail.html'
  ];
  const results = [];
  for (const rel of files) {
    const fullPath = path.join(process.cwd(), rel);
    const source = await fs.readFile(fullPath, 'utf8');
    results.push({
      file: rel,
      hasGuard: source.includes('ensureActivityShowcaseAccessAllowed(act)')
    });
  }
  return results;
}

async function checkDeployedGuard() {
  const pages = [
    '/student-gallery.html',
    '/student-upload.html',
    '/student-detail.html'
  ];
  const results = [];
  for (const page of pages) {
    const res = await fetch(`${STUDENT_BASE}${page}`);
    const html = await res.text();
    results.push({
      page,
      ok: res.ok,
      hasGuard: html.includes('ensureActivityShowcaseAccessAllowed(act)')
    });
  }
  return results;
}

async function main() {
  const inviteCode = makeInviteCode();
  const teacherPassword = makeTeacherPassword();
  const activityName = `自动验证-两学生登录-${inviteCode}`;

  console.log('Creating test activity...');
  const activity = await api(BACKEND_BASE, '/api/activities', {
    method: 'POST',
    body: JSON.stringify({
      course_name: COURSE_NAME,
      class_name: '自动验证班-请忽略',
      activity_name: activityName,
      description: '自动烟测创建，请忽略。',
      invite_code: inviteCode,
      teacher_password: teacherPassword
    })
  });

  const teacherLogin = await api(BACKEND_BASE, '/api/teacher/login', {
    method: 'POST',
    body: JSON.stringify({
      invite_code: inviteCode,
      password: teacherPassword
    })
  });
  const teacherToken = teacherLogin.token;
  if (!teacherToken) fail('Teacher token missing after login');

  console.log('Closing showcase controls for baseline test...');
  const closedActivity = await api(BACKEND_BASE, `/api/activities/${activity.id}`, {
    method: 'PUT',
    headers: {
      'x-teacher-auth': teacherToken
    },
    body: JSON.stringify({
      upload_open: false,
      voting_open: false,
      comments_open: false,
      show_live_ranking: false
    })
  });
  if (closedActivity.upload_open !== false) fail('Activity upload_open was not closed');

  console.log('Resolving public join target...');
  const publicActivity = await api(BACKEND_BASE, `/api/activities/code/${encodeURIComponent(inviteCode)}`);
  const registryPayload = await api(BACKEND_BASE, `/api/portal/course-registry?course_name=${encodeURIComponent(COURSE_NAME)}`);
  const entryPath = String(registryPayload?.course?.entry_path || '').trim();
  if (!entryPath) fail('Course entry path missing for economics course');

  console.log('Registering two students...');
  const students = [
    { name: '自动测试学生甲', student_id: `${inviteCode}-01`, group_name: 'A组' },
    { name: '自动测试学生乙', student_id: `${inviteCode}-02`, group_name: 'B组' }
  ];

  const registered = [];
  for (const student of students) {
    const user = await api(BACKEND_BASE, '/api/users', {
      method: 'POST',
      body: JSON.stringify({
        activity_id: activity.id,
        name: student.name,
        student_id: student.student_id,
        class_name: '自动验证班-请忽略',
        group_name: student.group_name
      })
    });
    if (!user.token) fail(`Student token missing for ${student.name}`);
    registered.push(user);
  }

  console.log('Sending learning heartbeats...');
  for (const user of registered) {
    await api(BACKEND_BASE, '/api/student/learning/heartbeat', {
      method: 'POST',
      headers: {
        'x-user-token': user.token
      },
      body: JSON.stringify({
        activity_id: activity.id,
        user_id: user.id,
        session_token: `smoke-${inviteCode}-${user.student_id}`,
        page_path: entryPath,
        active: true
      })
    });
  }
  await wait(2200);
  for (const user of registered) {
    await api(BACKEND_BASE, '/api/student/learning/heartbeat', {
      method: 'POST',
      headers: {
        'x-user-token': user.token
      },
      body: JSON.stringify({
        activity_id: activity.id,
        user_id: user.id,
        session_token: `smoke-${inviteCode}-${user.student_id}`,
        page_path: entryPath,
        active: true
      })
    });
  }

  console.log('Syncing course runtime progress...');
  let courseRuntimeReady = true;
  for (const [index, user] of registered.entries()) {
    const result = await api(BACKEND_BASE, '/api/student/course-runtime/progress', {
      method: 'POST',
      headers: {
        'x-user-token': user.token
      },
      body: JSON.stringify({
        activity_id: activity.id,
        user_id: user.id,
        course_slug: COURSE_SLUG,
        runtime_version: 'smoke-v1',
        learning_mode: 'selflearn',
        current_chapter: `第${index + 1}章`,
        current_lesson: `模块${index + 1}`,
        current_stage: 'smoke-check',
        progress_percent: 10 + (index * 15),
        completed_chapters: index,
        total_chapters: 16,
        xp: 20 + (index * 10),
        active: true,
        last_event: 'smoke-check',
        page_path: entryPath,
        client_updated_at: new Date().toISOString(),
        snapshot: {
          smoke: true,
          invite_code: inviteCode
        }
      })
    });
    if (result?.schema_ready === false) {
      courseRuntimeReady = false;
    }
  }

  console.log('Reading student summaries...');
  const studentSummaries = [];
  for (const user of registered) {
    const summary = await api(BACKEND_BASE, `/api/student/learning/summary?activity_id=${encodeURIComponent(activity.id)}&user_id=${encodeURIComponent(user.id)}`, {
      headers: {
        'x-user-token': user.token
      }
    });
    studentSummaries.push(summary);
  }

  console.log('Reading teacher dashboard summary...');
  const teacherSummary = await api(BACKEND_BASE, `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activity.id)}`, {
    headers: {
      'x-teacher-auth': teacherToken
    }
  });

  console.log('Checking local and deployed showcase guards...');
  const sourceGuard = await checkSourceGuard();
  const deployedGuard = await checkDeployedGuard();

  const learningRows = teacherSummary?.learning_engagement?.leaderboard || [];
  const studentNames = new Set(registered.map(user => String(user.name)));
  const seenNames = new Set(learningRows.map(row => String(row.name || '')));
  for (const name of studentNames) {
    if (!seenNames.has(name)) {
      fail(`Teacher dashboard summary is missing student ${name} in learning leaderboard`);
    }
  }

  const summary = {
    invite_code: inviteCode,
    activity_id: activity.id,
    course_entry_path: entryPath,
    public_activity_upload_open: publicActivity.upload_open,
    registered_students: registered.map(user => ({
      id: user.id,
      name: user.name,
      student_id: user.student_id
    })),
    student_learning: studentSummaries.map(item => ({
      my_name: item?.my?.name || '',
      active_minutes: item?.my?.active_minutes || 0,
      rank: item?.my?.rank || null
    })),
    teacher_learning_leaderboard: learningRows.slice(0, 5).map(row => ({
      name: row.name,
      active_minutes: row.active_minutes,
      rank: row.rank
    })),
    course_runtime_schema_ready: courseRuntimeReady,
    source_showcase_guard: sourceGuard,
    deployed_showcase_guard: deployedGuard
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
