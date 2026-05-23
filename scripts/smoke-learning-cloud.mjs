import { createClient } from '@supabase/supabase-js';

const DEFAULT_BASE_URL = 'https://classroom-showcase.onrender.com';
const COURSE_NAME = '经济学基础课程';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(input) {
  const value = String(input || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return value || DEFAULT_BASE_URL;
}

async function callJson(url, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    ...options,
    headers
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url} :: ${json?.error || text || response.statusText}`);
  }
  return json;
}

async function cleanupActivity(activityId) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey || !activityId) {
    return { ok: false, skipped: true, reason: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for cleanup.' };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error } = await admin.from('activities').delete().eq('id', activityId);
  if (error) throw error;
  return { ok: true, skipped: false };
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.argv[2]);
  const stamp = `${Date.now()}`.slice(-8);
  const inviteCode = `ECO${stamp}`;
  const teacherPassword = `Smoke-${stamp}`;
  const sessionToken = `smoke-${stamp}`;
  let activityId = null;

  try {
    const activity = await callJson(`${baseUrl}/api/activities`, {
      method: 'POST',
      body: JSON.stringify({
        course_name: COURSE_NAME,
        class_name: 'SMOKE-CLASS',
        activity_name: `Economics Smoke ${stamp}`,
        description: 'Temporary smoke test for economics course public rollout.',
        invite_code: inviteCode,
        teacher_password: teacherPassword
      })
    });
    activityId = activity?.id || null;
    if (!activityId) throw new Error('Activity creation did not return id.');

    const teacherLogin = await callJson(`${baseUrl}/api/teacher/login`, {
      method: 'POST',
      body: JSON.stringify({
        invite_code: inviteCode,
        password: teacherPassword
      })
    });
    const teacherToken = teacherLogin?.token;
    if (!teacherToken) throw new Error('Teacher login did not return token.');

    const student = await callJson(`${baseUrl}/api/users`, {
      method: 'POST',
      body: JSON.stringify({
        activity_id: activityId,
        name: 'Smoke Student',
        student_id: `SMOKE-${stamp}`,
        class_name: 'SMOKE-CLASS',
        group_name: 'SMOKE-GROUP'
      })
    });
    const userId = student?.id;
    const userToken = student?.token;
    if (!userId || !userToken) throw new Error('Student creation did not return id/token.');

    const firstHeartbeat = await callJson(`${baseUrl}/api/student/learning/heartbeat`, {
      method: 'POST',
      headers: { 'x-user-token': userToken },
      body: JSON.stringify({
        activity_id: activityId,
        user_id: userId,
        session_token: sessionToken,
        active: true,
        page_path: '/courses/economics-fundamentals/'
      })
    });

    await sleep(2500);

    const secondHeartbeat = await callJson(`${baseUrl}/api/student/learning/heartbeat`, {
      method: 'POST',
      headers: { 'x-user-token': userToken },
      body: JSON.stringify({
        activity_id: activityId,
        user_id: userId,
        session_token: sessionToken,
        active: true,
        page_path: '/courses/economics-fundamentals/'
      })
    });

    const summary = await callJson(`${baseUrl}/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activityId)}`, {
      headers: { 'x-teacher-auth': teacherToken }
    });

    const learning = summary?.learning_engagement || {};
    const leaderboard = Array.isArray(learning.leaderboard) ? learning.leaderboard : [];
    const tracked = Number(learning?.totals?.tracked_students || 0);
    const recentlyActive = Number(learning?.totals?.recently_active_count || 0);
    const foundStudent = leaderboard.find(row => String(row.user_id || '') === String(userId));

    if (!learning.schema_ready) {
      throw new Error(`Learning schema not ready: ${learning.error || 'unknown error'}`);
    }
    if (!foundStudent) {
      throw new Error('Teacher dashboard summary did not include the smoke student in leaderboard.');
    }
    if (tracked < 1 || recentlyActive < 1) {
      throw new Error(`Unexpected learning totals. tracked=${tracked} recently_active=${recentlyActive}`);
    }

    console.log(`Smoke test passed for ${baseUrl}`);
    console.log(`Activity ${activityId}`);
    console.log(`Invite code ${inviteCode}`);
    console.log(`Heartbeat totals: first=${firstHeartbeat?.total_seconds ?? '-'} second=${secondHeartbeat?.total_seconds ?? '-'}`);
    console.log(`Tracked students=${tracked}; recently active=${recentlyActive}`);
  } finally {
    if (activityId) {
      try {
        const cleanup = await cleanupActivity(activityId);
        if (cleanup.skipped) {
          console.log(`Cleanup skipped: ${cleanup.reason}`);
        } else {
          console.log(`Cleanup ok for activity ${activityId}`);
        }
      } catch (error) {
        console.error(`Cleanup failed for activity ${activityId}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
