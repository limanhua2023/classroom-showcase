const STUDENT_BASE = (process.env.CLASSSHOW_STUDENT_BASE || 'https://classshow-student.pages.dev').replace(/\/$/, '');
const BACKEND_BASE = (process.env.CLASSSHOW_BACKEND_BASE || 'https://classroom-showcase.onrender.com').replace(/\/$/, '');
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
    const detail = typeof body === 'string' ? body : body?.error || body?.detail || body?.message || JSON.stringify(body);
    fail(`${options.method || 'GET'} ${pathname} failed: ${res.status} ${detail}`);
  }
  return body;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeInviteCode() {
  return `SAVE${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function makeTeacherPassword() {
  return `save-${Math.random().toString(36).slice(2, 10)}!`;
}

function sessionToken(inviteCode, suffix) {
  return `save-flow-${inviteCode}-${suffix}`;
}

async function saveStudentCheckpoint(inviteCode, activityId, user, pagePath, reason) {
  await api(BACKEND_BASE, '/api/student/learning/heartbeat', {
    method: 'POST',
    headers: { 'x-user-token': user.token },
    body: JSON.stringify({
      activity_id: activityId,
      user_id: user.id,
      session_token: sessionToken(inviteCode, user.student_id),
      page_path: pagePath,
      active: true,
      course_slug: COURSE_SLUG,
      last_event: reason,
      client_total_seconds: 180
    })
  });
  await wait(2100);
  await api(BACKEND_BASE, '/api/student/learning/heartbeat', {
    method: 'POST',
    headers: { 'x-user-token': user.token },
    body: JSON.stringify({
      activity_id: activityId,
      user_id: user.id,
      session_token: sessionToken(inviteCode, user.student_id),
      page_path: pagePath,
      active: true,
      course_slug: COURSE_SLUG,
      last_event: reason,
      client_total_seconds: 183
    })
  });
  await api(BACKEND_BASE, '/api/student/learning/presence', {
    method: 'POST',
    headers: { 'x-user-token': user.token },
    body: JSON.stringify({
      activity_id: activityId,
      user_id: user.id,
      course_slug: COURSE_SLUG,
      pending_save: false,
      pending_local_seconds: 0,
      active: true,
      page_path: pagePath,
      last_local_update_at: new Date().toISOString()
    })
  });
}

async function saveModuleReflection(activityId, user, pagePath, chapterId, reflectionText, progressPercent = 0) {
  await api(BACKEND_BASE, '/api/student/course-runtime/progress', {
    method: 'POST',
    headers: { 'x-user-token': user.token },
    body: JSON.stringify({
      activity_id: activityId,
      user_id: user.id,
      course_slug: COURSE_SLUG,
      runtime_version: 'smoke-reflection-v1',
      learning_mode: 'selflearn',
      current_chapter: chapterId,
      current_lesson: chapterId,
      current_stage: 'reflection',
      progress_percent: progressPercent,
      completed_chapters: Math.max(0, Math.floor(chapterId / 3)),
      total_chapters: 16,
      xp: 100 + chapterId,
      active: true,
      last_event: 'reflection_submit',
      page_path: pagePath,
      client_updated_at: new Date().toISOString(),
      snapshot: {
        chapterProgress: {
          [String(chapterId)]: {
            reflectionDone: true
          }
        },
        reflections: {
          [`ch${chapterId}`]: reflectionText
        }
      }
    })
  });
}

async function saveTeacherModuleReview(activityId, teacherToken, userId, moduleId, teacherNote, reviewed) {
  const payload = {
    activity_id: activityId,
    user_id: userId,
    module_id: moduleId,
    teacher_note: teacherNote
  };
  if (reviewed !== undefined) payload.reviewed = reviewed;
  await api(BACKEND_BASE, '/api/teacher/module-evidence-review', {
    method: 'PUT',
    headers: { 'x-teacher-auth': teacherToken },
    body: JSON.stringify(payload)
  });
}

async function main() {
  const inviteCode = makeInviteCode();
  const teacherPassword = makeTeacherPassword();
  const activityName = `自动验证-保存链路-${inviteCode}`;
  const className = `自动验证班-${inviteCode}`;
  const registry = await api(BACKEND_BASE, '/api/portal/course-registry');
  const courseEntry = (registry?.courses || []).find(entry => String(entry.slug || '') === COURSE_SLUG);
  if (!courseEntry) fail(`Course registry is missing slug ${COURSE_SLUG}`);
  const courseName = String(courseEntry.course_name || '').trim();
  const pagePath = String(courseEntry.entry_path || '/courses/economics-fundamentals/').trim() || '/courses/economics-fundamentals/';
  if (!courseName) fail(`Course registry entry ${COURSE_SLUG} has no course_name`);

  const activity = await api(BACKEND_BASE, '/api/activities', {
    method: 'POST',
    body: JSON.stringify({
      course_name: courseName,
      class_name: className,
      activity_name: activityName,
      description: '自动烟测：学生保存状态链路',
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
  const publicActivity = await api(BACKEND_BASE, `/api/activities/code/${encodeURIComponent(inviteCode)}`);
  if (!publicActivity?.roster_gate_locked) fail('New economics activity should stay locked before roster import');

  const students = [
    { name: '保存链路学生甲', student_id: `${inviteCode}-01`, group_name: 'A组' },
    { name: '保存链路学生乙', student_id: `${inviteCode}-02`, group_name: 'B组' }
  ];

  const rosterImport = await api(BACKEND_BASE, '/api/teacher/roster/import', {
    method: 'POST',
    headers: { 'x-teacher-auth': teacherToken },
    body: JSON.stringify({
      activity_id: activity.id,
      default_class_name: className,
      students: students.map(student => ({
        name: student.name,
        student_id: student.student_id,
        class_name: className,
        group_name: student.group_name
      }))
    })
  });
  if (Number(rosterImport?.imported || 0) !== students.length) {
    fail(`Roster import count mismatch: expected ${students.length}, got ${rosterImport?.imported || 0}`);
  }
  const unlockedActivity = await api(BACKEND_BASE, `/api/activities/code/${encodeURIComponent(inviteCode)}`);
  if (unlockedActivity?.roster_gate_locked) fail('Economics activity should unlock after roster import');

  const registered = [];
  for (const student of students) {
    const user = await api(BACKEND_BASE, '/api/users', {
      method: 'POST',
      body: JSON.stringify({
        activity_id: activity.id,
        name: student.name,
        student_id: student.student_id,
        class_name: className,
        group_name: student.group_name
      })
    });
    if (!user?.id || !user?.token) fail(`Student registration failed for ${student.name}`);
    registered.push(user);
  }

  const studentA = registered[0];
  const studentB = registered[1];

  await saveModuleReflection(
    activity.id,
    studentA,
    pagePath,
    3,
    '我开始能用稀缺、机会成本和比较优势去分析大学生活中的课程选择与时间分配。',
    18
  );
  await saveModuleReflection(
    activity.id,
    studentB,
    pagePath,
    6,
    '我能把价格、激励和供求变化联系到校园饮品、手机和日常消费决策中。',
    36
  );

  await api(BACKEND_BASE, '/api/student/learning/presence', {
    method: 'POST',
    headers: { 'x-user-token': studentA.token },
    body: JSON.stringify({
      activity_id: activity.id,
      user_id: studentA.id,
      course_slug: COURSE_SLUG,
      pending_save: true,
      pending_local_seconds: 310,
      active: true,
      page_path: pagePath,
      last_local_update_at: new Date().toISOString()
    })
  });

  await saveStudentCheckpoint(inviteCode, activity.id, studentB, pagePath, 'manual_save');

  const summaryBefore = await api(BACKEND_BASE, `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activity.id)}`, {
    headers: { 'x-teacher-auth': teacherToken }
  });

  const learningBefore = summaryBefore?.learning_engagement || {};
  const rowABefore = (learningBefore?.leaderboard || []).find(row => row.user_id === studentA.id) || null;
  const rowBBefore = (learningBefore?.leaderboard || []).find(row => row.user_id === studentB.id) || null;
  if (!rowABefore || !rowBBefore) fail('Teacher dashboard rows missing before manual save');
  if (!rowABefore.pending_save || rowABefore.save_state !== 'pending') fail('Student A should be pending before manual save');
  if (rowBBefore.pending_save || rowBBefore.save_state !== 'saved' || !rowBBefore.last_saved_at) fail('Student B should already be saved before manual save');

  await saveStudentCheckpoint(inviteCode, activity.id, studentA, pagePath, 'manual_save');

  const summaryAfter = await api(BACKEND_BASE, `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activity.id)}`, {
    headers: { 'x-teacher-auth': teacherToken }
  });

  const learningAfter = summaryAfter?.learning_engagement || {};
  const rowAAfter = (learningAfter?.leaderboard || []).find(row => row.user_id === studentA.id) || null;
  const rowBAfter = (learningAfter?.leaderboard || []).find(row => row.user_id === studentB.id) || null;
  if (!rowAAfter || !rowBAfter) fail('Teacher dashboard rows missing after manual save');
  if (rowAAfter.pending_save || rowAAfter.save_state !== 'saved' || !rowAAfter.last_saved_at) fail('Student A manual save did not reach teacher dashboard');
  if (Number(learningAfter?.totals?.pending_save_count || 0) !== 0) fail('Pending save count should be zero after both saves');

  const moduleEvidence = summaryAfter?.learning_module_evidence || {};
  const moduleRowA = (moduleEvidence?.rows || []).find(row => row.user_id === studentA.id) || null;
  const moduleRowB = (moduleEvidence?.rows || []).find(row => row.user_id === studentB.id) || null;
  if (!moduleRowA || !moduleRowB) fail('Teacher dashboard module evidence rows are missing');
  if (Number(moduleRowA.module_completed_count || 0) < 1 || moduleRowA.latest_module_title !== '模块一综合复盘') {
    fail('Student A module synthesis evidence did not reach teacher dashboard');
  }
  if (Number(moduleRowB.module_completed_count || 0) < 1 || moduleRowB.latest_module_title !== '模块二综合复盘') {
    fail('Student B module synthesis evidence did not reach teacher dashboard');
  }

  await saveTeacherModuleReview(
    activity.id,
    teacherToken,
    studentA.id,
    'module-1',
    '老师点评：已经能把稀缺、机会成本和比较优势串起来分析大学生活选择。',
    true
  );
  await saveTeacherModuleReview(
    activity.id,
    teacherToken,
    studentB.id,
    'module-2',
    '老师点评：已经能把价格、供求与校园消费联系起来。',
    false
  );

  const studentProgressAfterTeacherReview = await api(
    BACKEND_BASE,
    `/api/student/course-runtime/progress?activity_id=${encodeURIComponent(activity.id)}&user_id=${encodeURIComponent(studentA.id)}&course_slug=${encodeURIComponent(COURSE_SLUG)}`,
    {
      headers: { 'x-user-token': studentA.token }
    }
  );
  if (studentProgressAfterTeacherReview?.progress?.snapshot?.teacher_module_reviews) {
    fail('Student course runtime API should not expose teacher private review snapshot');
  }

  await saveModuleReflection(
    activity.id,
    studentA,
    pagePath,
    3,
    '学生再次保存后，老师点评仍应保留，且模块一综合复盘证据不能被新的学生保存覆盖。',
    22
  );

  const summaryReviewed = await api(BACKEND_BASE, `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activity.id)}`, {
    headers: { 'x-teacher-auth': teacherToken }
  });
  const reviewedEvidence = summaryReviewed?.learning_module_evidence || {};
  const reviewedRowA = (reviewedEvidence?.rows || []).find(row => row.user_id === studentA.id) || null;
  const reviewedRowB = (reviewedEvidence?.rows || []).find(row => row.user_id === studentB.id) || null;
  const reviewedModuleA = (reviewedRowA?.modules || []).find(item => item.module_id === 'module-1') || null;
  const reviewedModuleB = (reviewedRowB?.modules || []).find(item => item.module_id === 'module-2') || null;
  if (!reviewedModuleA?.reviewed || !String(reviewedModuleA?.teacher_note || '').includes('机会成本')) {
    fail('Teacher reviewed note for student A was not preserved on the dashboard');
  }
  if (reviewedModuleB?.reviewed || !String(reviewedModuleB?.teacher_note || '').includes('校园消费')) {
    fail('Teacher note-only state for student B was not preserved on the dashboard');
  }

  const deployedJs = await fetch(`${STUDENT_BASE}/js/economics-course-adapter.js?t=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache, no-store' }
  }).then(res => res.text());
  const teacherHtml = await fetch(`${BACKEND_BASE}/teacher-dashboard.html?t=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache, no-store' }
  }).then(res => res.text());
  const frontendChecks = {
    save_button_present: deployedJs.includes('classshowEconSaveBtn'),
    save_button_primary: deployedJs.includes('class="primary" id="classshowEconSaveBtn"'),
    legacy_portal_removed: !deployedJs.includes('classshowEconPortalBtn')
      && !deployedJs.includes('classshowEconIndexBtn')
      && !deployedJs.includes('classshowEconModularBtn'),
    teacher_module_panel_present: teacherHtml.includes('learningModuleEvidenceList'),
    teacher_module_export_present: teacherHtml.includes('exportLearningModuleEvidenceWorkbook'),
    teacher_module_review_present: teacherHtml.includes('saveModuleEvidenceReviewFromButton')
      && teacherHtml.includes('/teacher/module-evidence-review')
  };
  if (!frontendChecks.save_button_present
    || !frontendChecks.save_button_primary
    || !frontendChecks.legacy_portal_removed
    || !frontendChecks.teacher_module_panel_present
    || !frontendChecks.teacher_module_export_present
    || !frontendChecks.teacher_module_review_present) {
    fail(`Student frontend toolbar is not in expected state: ${JSON.stringify(frontendChecks)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    invite_code: inviteCode,
    activity_id: activity.id,
    frontend_checks: frontendChecks,
    before_manual_save: {
      pending_save_count: Number(learningBefore?.totals?.pending_save_count || 0),
      student_a: {
        save_state: rowABefore.save_state,
        pending_save: rowABefore.pending_save,
        pending_local_seconds: rowABefore.pending_local_seconds,
        last_saved_at: rowABefore.last_saved_at
      },
      student_b: {
        save_state: rowBBefore.save_state,
        pending_save: rowBBefore.pending_save,
        pending_local_seconds: rowBBefore.pending_local_seconds,
        last_saved_at: rowBBefore.last_saved_at
      }
    },
    after_manual_save: {
      pending_save_count: Number(learningAfter?.totals?.pending_save_count || 0),
      student_a: {
        save_state: rowAAfter.save_state,
        pending_save: rowAAfter.pending_save,
        pending_local_seconds: rowAAfter.pending_local_seconds,
        last_saved_at: rowAAfter.last_saved_at
      },
      student_b: {
        save_state: rowBAfter.save_state,
        pending_save: rowBAfter.pending_save,
        pending_local_seconds: rowBAfter.pending_local_seconds,
        last_saved_at: rowBAfter.last_saved_at
      }
    },
    module_evidence: {
      student_a: {
        completed: moduleRowA.module_completed_count,
        latest_title: moduleRowA.latest_module_title,
        latest_excerpt: moduleRowA.latest_module_excerpt
      },
      student_b: {
        completed: moduleRowB.module_completed_count,
        latest_title: moduleRowB.latest_module_title,
        latest_excerpt: moduleRowB.latest_module_excerpt
      }
    },
    teacher_reviews: {
      student_a: {
        reviewed: reviewedModuleA?.reviewed || false,
        teacher_note: reviewedModuleA?.teacher_note || ''
      },
      student_b: {
        reviewed: reviewedModuleB?.reviewed || false,
        teacher_note: reviewedModuleB?.teacher_note || ''
      }
    }
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
