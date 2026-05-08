import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';

const BASE_URL = String(process.env.CLASS_SHOW_BASE_URL || 'https://classroom-showcase.onrender.com').replace(/\/+$/, '');
const INVITE_CODE = String(process.env.CLASS_SHOW_INVITE_CODE || 'DPU139').trim();
const TEACHER_PASSWORD = String(process.env.CLASS_SHOW_TEACHER_PASSWORD || '').trim();
const WRITE_MODE = /^true$/i.test(String(process.env.OPS_PRESSURE_WRITE || 'false'));
const STUDENT_COUNT = Math.max(1, Number(process.env.OPS_PRESSURE_STUDENTS || 3));
const WORKS_PER_STUDENT = Math.max(1, Number(process.env.OPS_PRESSURE_WORKS_PER_STUDENT || 2));
const READ_CONCURRENCY = Math.max(1, Number(process.env.OPS_PRESSURE_READ_CONCURRENCY || 20));
const READ_ROUNDS = Math.max(1, Number(process.env.OPS_PRESSURE_READ_ROUNDS || 4));
const INCLUDE_VIDEO = /^true$/i.test(String(process.env.OPS_PRESSURE_INCLUDE_VIDEO || 'true'));
const REPORT_DIR = path.resolve('tmp_e2e_report');
const MEDIA_DIR = path.resolve('tmp_e2e_media', 'ops_pressure');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

if (!TEACHER_PASSWORD) {
  throw new Error('Missing CLASS_SHOW_TEACHER_PASSWORD. Set it before running the ops pressure test.');
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function summarizeLatencies(results) {
  const latencies = results.map(item => item.latency_ms).filter(Number.isFinite);
  const failures = results.filter(item => !item.ok);
  const total = results.length;
  const average = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : 0;
  return {
    total,
    ok: total - failures.length,
    failed: failures.length,
    failure_rate: total ? Math.round((failures.length / total) * 10000) / 100 : 0,
    avg_ms: average,
    p50_ms: Math.round(percentile(latencies, 0.5)),
    p95_ms: Math.round(percentile(latencies, 0.95)),
    max_ms: Math.round(Math.max(0, ...latencies))
  };
}

function summarizeByRoute(results) {
  const groups = new Map();
  for (const item of results) {
    const current = groups.get(item.route) || [];
    current.push(item);
    groups.set(item.route, current);
  }
  return Array.from(groups.entries())
    .map(([route, items]) => ({
      route,
      ...summarizeLatencies(items)
    }))
    .sort((a, b) => b.p95_ms - a.p95_ms || b.failed - a.failed);
}

async function requestJson(method, route, { headers = {}, body, formData = null, allowNonJson = false } = {}) {
  const url = route.startsWith('http') ? route : `${BASE_URL}${route}`;
  const started = Date.now();
  const init = { method, headers: { ...headers } };
  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!allowNonJson) {
          data = { raw: text.slice(0, 500) };
        } else {
          data = text;
        }
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      route,
      latency_ms: Date.now() - started,
      headers: Object.fromEntries(response.headers.entries()),
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      route,
      latency_ms: Date.now() - started,
      error: error.message
    };
  }
}

function responseSizeBytes(data) {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (data === null || data === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(data));
}

function requireOk(result, label) {
  if (!result.ok) {
    const detail = result.error || result.data?.error || JSON.stringify(result.data || {});
    throw new Error(`${label} failed: HTTP ${result.status} ${detail}`);
  }
  return result.data;
}

async function runPool(tasks, concurrency) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function createSyntheticImage(studentIndex, workIndex) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const title = `OPS ${RUN_ID}-${studentIndex + 1}-${workIndex + 1}`;
  const svg = Buffer.from(`
    <svg width="1200" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#19d3da" offset="0"/>
          <stop stop-color="#7af05f" offset="0.55"/>
          <stop stop-color="#ff6b35" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="720" fill="url(#g)"/>
      <circle cx="${160 + studentIndex * 90}" cy="${140 + workIndex * 120}" r="150" fill="rgba(255,255,255,0.25)"/>
      <rect x="74" y="486" width="1052" height="130" rx="34" fill="rgba(5,12,28,0.72)"/>
      <text x="110" y="560" font-size="54" font-family="Arial, sans-serif" font-weight="700" fill="#ffffff">${title}</text>
      <text x="110" y="604" font-size="28" font-family="Arial, sans-serif" fill="#dbeafe">ClassShow ops pressure artifact</text>
    </svg>
  `);
  const buffer = await sharp(svg).png().toBuffer();
  const filename = `ops_${RUN_ID}_${studentIndex + 1}_${workIndex + 1}.png`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buffer);
  return { buffer, filename, title, filePath };
}

async function runFfmpeg(args) {
  if (!ffmpegStatic) throw new Error('ffmpeg-static is unavailable');
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1000) || `ffmpeg exited with ${code}`));
    });
  });
}

async function createSyntheticVideo(studentIndex, workIndex) {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const title = `OPS VIDEO ${RUN_ID}-${studentIndex + 1}-${workIndex + 1}`;
  const filename = `ops_${RUN_ID}_${studentIndex + 1}_${workIndex + 1}.mp4`;
  const filePath = path.join(MEDIA_DIR, filename);
  const hue = (studentIndex * 45 + workIndex * 90) % 360;
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=960x540:rate=24:duration=4`,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', `hue=h=${hue}:s=1.2`,
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    filePath
  ]);
  const buffer = await fs.readFile(filePath);
  return { buffer, filename, title, filePath, contentType: 'video/mp4', mediaKind: 'video' };
}

async function createSyntheticMedia(studentIndex, workIndex) {
  const shouldCreateVideo = INCLUDE_VIDEO
    && workIndex === WORKS_PER_STUDENT - 1
    && studentIndex % 3 === 0;
  if (shouldCreateVideo) {
    try {
      return await createSyntheticVideo(studentIndex, workIndex);
    } catch (error) {
      console.warn(`Video generation failed, falling back to image: ${error.message}`);
    }
  }
  const image = await createSyntheticImage(studentIndex, workIndex);
  return { ...image, contentType: 'image/png', mediaKind: 'image' };
}

function buildTeacherHeaders(token) {
  return { 'x-teacher-auth': token };
}

function buildStudentHeaders(token) {
  return { 'x-user-token': token };
}

async function main() {
  const report = {
    started_at: new Date().toISOString(),
    base_url: BASE_URL,
    invite_code: INVITE_CODE,
    run_id: RUN_ID,
    config: {
      write_mode: WRITE_MODE,
      student_count: STUDENT_COUNT,
      works_per_student: WORKS_PER_STUDENT,
      read_concurrency: READ_CONCURRENCY,
      read_rounds: READ_ROUNDS
    },
    checks: {},
    created: {
      students: [],
      submissions: [],
      interactions: []
    },
    findings: [],
    recommendations: []
  };

  const health = await requestJson('GET', '/api/health');
  report.checks.health = health;

  const login = requireOk(await requestJson('POST', '/api/teacher/login', {
    body: { invite_code: INVITE_CODE, password: TEACHER_PASSWORD }
  }), 'teacher login');
  const teacherToken = login.token;
  const activity = login.activity;
  const activityId = activity.id;
  report.activity = {
    id: activityId,
    name: activity.activity_name,
    invite_code: activity.invite_code
  };

  const teacherHeaders = buildTeacherHeaders(teacherToken);
  const baseline = requireOk(await requestJson('GET', `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activityId)}`, {
    headers: teacherHeaders
  }), 'dashboard baseline');
  report.checks.baseline = {
    metrics: baseline.metrics,
    storage: baseline.storage,
    missing_media: baseline.missing_media
  };

  if (WRITE_MODE) {
    const rosterStudents = Array.from({ length: STUDENT_COUNT }, (_, index) => ({
      name: `OpsStress${RUN_ID}${String(index + 1).padStart(2, '0')}`,
      student_id: `OPS${RUN_ID}${String(index + 1).padStart(2, '0')}`,
      class_name: 'OPS-STRESS'
    }));

    const importResult = requireOk(await requestJson('POST', '/api/teacher/roster/import', {
      headers: teacherHeaders,
      body: {
        activity_id: activityId,
        default_class_name: 'OPS-STRESS',
        students: rosterStudents
      }
    }), 'roster import');
    report.checks.roster_import = importResult;

    for (const rosterStudent of rosterStudents) {
      const user = requireOk(await requestJson('POST', '/api/users', {
        body: {
          activity_id: activityId,
          name: rosterStudent.name,
          student_id: rosterStudent.student_id,
          class_name: rosterStudent.class_name
        }
      }), `student login ${rosterStudent.student_id}`);
      report.created.students.push({
        id: user.id,
        name: user.name,
        student_id: user.student_id,
        token_present: !!user.token
      });
    }

    for (let studentIndex = 0; studentIndex < report.created.students.length; studentIndex += 1) {
      const student = report.created.students[studentIndex];
      const token = requireOk(await requestJson('POST', '/api/users', {
        body: {
          activity_id: activityId,
          name: student.name,
          student_id: student.student_id,
          class_name: 'OPS-STRESS'
        }
      }), `refresh student token ${student.student_id}`).token;

      for (let workIndex = 0; workIndex < WORKS_PER_STUDENT; workIndex += 1) {
        const image = await createSyntheticMedia(studentIndex, workIndex);
        const formData = new FormData();
        formData.set('activity_id', activityId);
        formData.set('user_id', student.id);
        formData.set('image', new Blob([image.buffer], { type: image.contentType }), image.filename);

        const upload = requireOk(await requestJson('POST', '/api/upload', {
          headers: buildStudentHeaders(token),
          formData
        }), `upload ${student.student_id} ${workIndex + 1}`);

        const submission = requireOk(await requestJson('POST', '/api/submissions', {
          headers: buildStudentHeaders(token),
          body: {
            activity_id: activityId,
            user_id: student.id,
            title: image.title,
            description: `Automated ops pressure test image ${studentIndex + 1}-${workIndex + 1}.`,
            image_url: upload.url,
            storage_path: upload.path,
            media_size: upload.size,
            thumbnail_url: upload.thumbnail_url,
            thumbnail_path: upload.thumbnail_path,
            original_media_size: upload.original_size,
            compressed: upload.compressed,
            saved_bytes: upload.saved_bytes,
            saved_percent: upload.saved_percent,
            transcode_status: upload.transcode_status
          }
        }), `submission ${student.student_id} ${workIndex + 1}`);

        report.created.submissions.push({
          id: submission.id,
          anonymous_code: submission.anonymous_code,
          user_id: student.id,
          title: submission.title,
          media_type: submission.media_type,
          generated_media_kind: image.mediaKind,
          thumbnail_present: !!submission.thumbnail_url,
          storage_path: submission.storage_path
        });
      }
    }

    const tokenByUserId = new Map();
    for (const student of report.created.students) {
      const user = requireOk(await requestJson('POST', '/api/users', {
        body: {
          activity_id: activityId,
          name: student.name,
          student_id: student.student_id,
          class_name: 'OPS-STRESS'
        }
      }), `interaction token ${student.student_id}`);
      tokenByUserId.set(student.id, user.token);
    }

    for (let index = 0; index < report.created.students.length; index += 1) {
      const viewer = report.created.students[index];
      const targetOwner = report.created.students[(index + 1) % report.created.students.length];
      const target = report.created.submissions.find(item => item.user_id === targetOwner.id);
      const token = tokenByUserId.get(viewer.id);
      if (!target || !token) continue;

      const headers = buildStudentHeaders(token);
      const view = await requestJson('POST', '/api/views', {
        headers,
        body: { activity_id: activityId, submission_id: target.id, viewer_user_id: viewer.id }
      });
      const rating = await requestJson('POST', '/api/ratings', {
        headers,
        body: { activity_id: activityId, submission_id: target.id, rater_user_id: viewer.id, score: 4 + (index % 2) }
      });
      const comment = await requestJson('POST', '/api/comments', {
        headers,
        body: { activity_id: activityId, submission_id: target.id, user_id: viewer.id, content: `Ops pressure comment ${RUN_ID}-${index + 1}` }
      });
      const feedback = await requestJson('POST', '/api/activity-feedback', {
        headers,
        body: { activity_id: activityId, user_id: viewer.id, content: `Ops feedback ${RUN_ID}-${index + 1}: dashboard and display remain responsive.` }
      });
      report.created.interactions.push({
        viewer_user_id: viewer.id,
        target_submission_id: target.id,
        view_status: view.status,
        rating_status: rating.status,
        comment_status: comment.status,
        feedback_status: feedback.status
      });
    }
  }

  const readRoutes = [
    () => requestJson('GET', `/api/activities/code/${encodeURIComponent(INVITE_CODE)}`),
    () => requestJson('GET', `/api/submissions?activity_id=${encodeURIComponent(activityId)}`),
    () => requestJson('GET', `/api/rankings?activity_id=${encodeURIComponent(activityId)}`),
    () => requestJson('GET', `/api/activity-feedback?activity_id=${encodeURIComponent(activityId)}&sort=hot`),
    () => requestJson('GET', `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activityId)}`, { headers: teacherHeaders }),
    () => requestJson('GET', `/api/teacher/missing-media-export?activity_id=${encodeURIComponent(activityId)}&format=json`, { headers: teacherHeaders })
  ];

  const readTasks = [];
  const totalReadRequests = READ_CONCURRENCY * READ_ROUNDS;
  for (let index = 0; index < totalReadRequests; index += 1) {
    readTasks.push(readRoutes[index % readRoutes.length]);
  }
  const readResults = await runPool(readTasks, READ_CONCURRENCY);
  report.checks.read_pressure = {
    summary: summarizeLatencies(readResults),
    route_summary: summarizeByRoute(readResults),
    failures: readResults
      .filter(item => !item.ok)
      .slice(0, 10)
      .map(item => ({ route: item.route, status: item.status, error: item.error || item.data?.error || item.data?.raw }))
  };

  const snapshotResult = await requestJson('GET', `/api/teacher/backup-snapshot/export?activity_id=${encodeURIComponent(activityId)}`, {
    headers: teacherHeaders,
    allowNonJson: true
  });
  report.checks.snapshot = {
    ok: snapshotResult.ok,
    status: snapshotResult.status,
    latency_ms: snapshotResult.latency_ms,
    sha256_present: !!snapshotResult.headers?.['x-classshow-snapshot-sha256'],
    size_bytes: responseSizeBytes(snapshotResult.data)
  };

  const archiveRun = await requestJson('POST', '/api/teacher/archive-run', {
    headers: teacherHeaders,
    body: { activity_id: activityId }
  });
  report.checks.archive_run = {
    ok: archiveRun.ok,
    status: archiveRun.status,
    latency_ms: archiveRun.latency_ms,
    data: archiveRun.data
  };

  const missingMedia = requireOk(await requestJson('GET', `/api/teacher/missing-media-export?activity_id=${encodeURIComponent(activityId)}&format=json`, {
    headers: teacherHeaders
  }), 'missing media export');
  const finalDashboard = requireOk(await requestJson('GET', `/api/teacher/dashboard-summary?activity_id=${encodeURIComponent(activityId)}`, {
    headers: teacherHeaders
  }), 'dashboard final');
  report.checks.final = {
    metrics: finalDashboard.metrics,
    storage: finalDashboard.storage,
    missing_media: missingMedia.missing_media
  };

  const readSummary = report.checks.read_pressure.summary;
  if (!health.ok) {
    report.findings.push({
      severity: 'medium',
      area: 'health',
      message: '/api/health is not healthy or not deployed yet.',
      detail: health.data?.error || health.data?.supabase_error || health.status
    });
  }
  if (readSummary.failed > 0) {
    report.findings.push({
      severity: 'high',
      area: 'pressure',
      message: `${readSummary.failed} read requests failed during pressure test.`,
      detail: report.checks.read_pressure.failures
    });
  }
  if (readSummary.p95_ms > 5000) {
    report.findings.push({
      severity: 'medium',
      area: 'performance',
      message: `Read p95 latency is ${readSummary.p95_ms}ms, above the 5000ms classroom target.`
    });
  }
  if (!report.checks.snapshot.sha256_present) {
    report.findings.push({
      severity: 'medium',
      area: 'backup',
      message: 'Backup snapshot response is missing SHA-256 header.'
    });
  }
  if (missingMedia.missing_media?.source_missing_count > 0) {
    report.findings.push({
      severity: 'high',
      area: 'media-integrity',
      message: `${missingMedia.missing_media.source_missing_count} submissions still have missing primary media.`,
      detail: 'These are historical broken objects unless they match the current run IDs.'
    });
  }
  if (missingMedia.missing_media?.archive_failed_count > 0) {
    report.findings.push({
      severity: 'medium',
      area: 'archive',
      message: `${missingMedia.missing_media.archive_failed_count} archive items are failed.`
    });
  }

  report.recommendations.push(
    'Keep ARCHIVE_DELETE_PRIMARY_AFTER_SUCCESS=false until Google Drive restores have been verified for several classes.',
    'Run ops:pressure after every schema or media-pipeline deployment.',
    'Use the missing-media failure export as the first artifact when diagnosing broken thumbnails or old missing files.',
    'If DPU139 grows quickly, set archive_after_days to 3 or 7 and schedule weekly snapshot archive exports.'
  );
  report.completed_at = new Date().toISOString();

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `ops_pressure_report_${RUN_ID}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify({
    report: reportPath,
    base_url: BASE_URL,
    invite_code: INVITE_CODE,
    write_mode: WRITE_MODE,
    read_pressure: report.checks.read_pressure.summary,
    created_students: report.created.students.length,
    created_submissions: report.created.submissions.length,
    findings: report.findings
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
