(function initEconomicsCourseAdapter() {
  const COURSE_NAME = '经济学基础';
  const COURSE_SLUG = 'economics-fundamentals';
  const LOCAL_STUDY_TICK_MS = 15000;
  const CLOUD_SAVE_REMINDER_MS = 5 * 60 * 1000;
  const PROGRESS_SYNC_DEBOUNCE_MS = 1500;
  const LEARNING_SESSION_KEY = 'classshow_learning_session_token';
  const AI_MODE_KEY = 'econCourse_v117_ai_mode';
  const AI_KEY_KEY = 'econCourse_v117_api_key';
  const ECON_SESSION_KEY_PREFIX = 'econCourse_v117_';
  const LOCAL_STUDY_STATS_KEY = 'econCourse_v117_self_study_stats';
  const LOCAL_STUDY_MAX_DELTA_SECONDS = 90;
  const LEGACY_LOCAL_STUDY_STATS_KEY = 'econCourse_v117_self_study_stats';
  function studentUrl(path = '') {
    return typeof window.classShowStudentUrl === 'function'
      ? window.classShowStudentUrl(path)
      : path;
  }

  function backendUrl(path = '') {
    return typeof window.classShowBackendUrl === 'function'
      ? window.classShowBackendUrl(path)
      : path;
  }

  const REMOTE_SNAPSHOT_KEYS = [
    'learningMode',
    'currentLesson',
    'currentChapter',
    'currentStage',
    'xp',
    'done',
    'completedLessons',
    'completedChapters',
    'completedStages',
    'chapterProgress',
    'lessonProgress',
    'stageProgress',
    'wrongQuestions',
    'reflections',
    'storyStageProgress',
    'storyIncorrectAttempts',
    'completedStoryChallenges',
    'completedSandboxes',
    'chatTurn',
    'currentActiveChapter',
    'ppfInteracted',
    'completedQuests',
    'chapterThoughts',
    'chapterThoughtDrafts'
  ];
  const PROGRESS_STATE_KEYS = [
    'xp',
    'done',
    'achs',
    'perfects',
    'scores',
    'streak',
    'chapterProgress',
    'completedLessons',
    'completedChapters',
    'completedStages',
    'storyStageProgress',
    'storyIncorrectAttempts',
    'completedStoryChallenges',
    'wrongQuestions',
    'reflections'
  ];

  const params = new URLSearchParams(location.search);
  const wantsTeacherMode = params.get('teacher') === '1';
  const initialContext = readContext();
  const runtime = {
    context: initialContext,
    heartbeatTimer: null,
    syncTimer: null,
    syncBusy: false,
    cloudSaveBusy: false,
    syncReason: 'idle',
    syncLabel: '未开始同步',
    syncLevel: 'local',
    teacherReady: false,
    teacherLoading: false,
    teacherLoadedAt: '',
    teacherError: '',
    teacherEntrypoints: [],
    appPatched: false,
    hydrating: false,
    originalToggleTeacherMode: null,
    originalStorageLoad: null,
    originalStorageSave: null,
    originalStorageReset: null,
    originalBridge: window.EconCourseBridge || {},
    localStudySessionToken: '',
    localStudy: readLocalStudyStats(initialContext),
    progressDirty: false
  };
  runtime.localStudySessionToken = getLearningSessionToken();

  forceLocalAiMode();
  injectBridgeStyles();
  if (!ensureCourseAccess()) return;
  unlockCourseSurface();
  injectBridgeShell();
  hideTeacherEntrypoints();
  patchCourseBridge();
  patchAiControls();
  patchAppRuntime();
  syncActivityContextFromBackend();
  scheduleTeacherBootstrap();
  scheduleRemoteHydration();
  startLearningHeartbeat();
  updateBridgeShell();

  function readContext() {
    if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.getContext === 'function') {
      return window.ClassShowCourseRuntime.getContext();
    }
    return {
      course_name: COURSE_NAME,
      activity_id: '',
      activity: null,
      user: null,
      is_guest: false
    };
  }

  function injectBridgeStyles() {
    if (document.getElementById('classshow-econ-bridge-style')) return;
    const style = document.createElement('style');
    style.id = 'classshow-econ-bridge-style';
    style.textContent = `
      body.classshow-econ-locked > *:not(#classshow-econ-auth-gate) {
        display: none !important;
      }
      #classshow-econ-auth-gate {
        position: fixed;
        inset: 0;
        z-index: 12000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(245, 158, 11, 0.18), transparent 34%),
          radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.16), transparent 32%),
          rgba(3, 10, 22, 0.94);
        font: 14px/1.6 "Noto Sans SC", "Segoe UI", sans-serif;
      }
      .classshow-econ-auth-card {
        width: min(720px, 100%);
        padding: 30px;
        border-radius: 28px;
        color: #f8fafc;
        background: linear-gradient(145deg, rgba(12, 22, 39, 0.96), rgba(20, 32, 54, 0.92));
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 28px 80px rgba(2, 8, 23, 0.48);
      }
      .classshow-econ-auth-card h1 {
        margin: 0 0 12px;
        font-size: clamp(28px, 5vw, 44px);
        line-height: 1.08;
      }
      .classshow-econ-auth-card p {
        margin: 0;
        color: rgba(226, 232, 240, 0.92);
      }
      .classshow-econ-auth-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 18px;
        padding: 6px 12px;
        border-radius: 999px;
        color: #fde68a;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(245, 158, 11, 0.28);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .classshow-econ-auth-note {
        margin-top: 18px;
        padding: 16px 18px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .classshow-econ-auth-note strong {
        display: block;
        margin-bottom: 6px;
        font-size: 13px;
      }
      .classshow-econ-auth-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      .classshow-econ-auth-actions a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 800;
      }
      .classshow-econ-auth-actions a.primary {
        color: #fff7ed;
        background: linear-gradient(135deg, #f59e0b, #c2410c);
        box-shadow: 0 14px 30px rgba(245, 158, 11, 0.24);
      }
      .classshow-econ-auth-actions a.secondary {
        color: #e2e8f0;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      #classshow-econ-bridge {
        position: fixed;
        top: 12px;
        left: 12px;
        right: 12px;
        z-index: 9999;
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-radius: 16px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.32);
        backdrop-filter: blur(14px);
        font: 13px/1.35 "Noto Sans SC", "Segoe UI", sans-serif;
      }
      #classshow-econ-bridge strong {
        display: block;
        margin-bottom: 2px;
        font-size: 13px;
      }
      .classshow-econ-bridge-copy {
        min-width: 0;
        flex: 1 1 auto;
      }
      .classshow-econ-bridge-copy small,
      .classshow-econ-bridge-sync {
        display: block;
        opacity: 0.84;
      }
      .classshow-econ-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 4px;
      }
      .classshow-econ-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.09);
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      .classshow-econ-chip.ok { background: rgba(22, 163, 74, 0.2); color: #bbf7d0; }
      .classshow-econ-chip.warn { background: rgba(234, 179, 8, 0.18); color: #fde68a; }
      .classshow-econ-chip.err { background: rgba(239, 68, 68, 0.2); color: #fecaca; }
      .classshow-econ-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .classshow-econ-actions button {
        min-height: 36px;
        padding: 0 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.06);
        color: #f8fafc;
        cursor: pointer;
        font: inherit;
      }
      .classshow-econ-actions button.primary {
        background: linear-gradient(135deg, #f59e0b, #b45309);
        border-color: rgba(245, 158, 11, 0.45);
      }
      @media (max-width: 860px) {
        #classshow-econ-auth-gate {
          padding: 16px;
        }
        .classshow-econ-auth-card {
          padding: 22px 18px;
          border-radius: 22px;
        }
        #classshow-econ-bridge {
          flex-direction: column;
          align-items: stretch;
        }
        .classshow-econ-actions {
          justify-content: stretch;
        }
        .classshow-econ-actions button {
          flex: 1 1 140px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function unlockCourseSurface() {
    if (typeof setActivityEntryPath === 'function') {
      setActivityEntryPath(currentStudentPath());
    }
    document.documentElement.removeAttribute('data-classshow-locked');
    if (document.body) {
      document.body.classList.add('classshow-auth-ready');
      document.body.classList.remove('classshow-econ-locked');
    }
  }

  function ensureCourseAccess() {
    const access = getAccessState();
    if (access.allowed) {
      if (document.body) document.body.classList.remove('classshow-econ-locked');
      return true;
    }
    injectAccessGate(access);
    document.documentElement.removeAttribute('data-classshow-locked');
    if (document.body) document.body.classList.add('classshow-econ-locked', 'classshow-auth-ready');
    return false;
  }

  function injectAccessGate(access) {
    if (document.getElementById('classshow-econ-auth-gate')) return;
    const gate = document.createElement('section');
    gate.id = 'classshow-econ-auth-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');

    const primaryAction = buildPrimaryAccessAction(access);
    const helperCopy = access.courseMatched === false && access.activityCourseName
      ? `当前会话绑定的是《${escapeText(access.activityCourseName)}》活动，请从正确课程入口重新进入。`
      : access.activityReady
        ? '当前活动已绑定成功。请从学生入口继续，以学生身份进入课程学习。'
        : '请先在学生入口填写姓名、学号和邀请码，再进入经济学基础学习。';

    gate.innerHTML = `
      <div class="classshow-econ-auth-card">
        <div class="classshow-econ-auth-kicker">STUDENT LOGIN REQUIRED</div>
        <h1>登录后才能进入经济学基础</h1>
        <p>为了准确记录学习时长、学习进度和具体学生身份，本课程仅向已登录学生开放。登录后，系统才会把学习记录绑定到正确学生名下。</p>
        <div class="classshow-econ-auth-note">
          <strong>${escapeText(access.isGuest ? '当前是访客模式' : '当前尚未完成学生登录')}</strong>
          <span>${escapeText(helperCopy)}</span>
        </div>
        <div class="classshow-econ-auth-actions">
          <a class="primary" href="${escapeText(primaryAction.href)}">${escapeText(primaryAction.label)}</a>
        </div>
      </div>
    `;
    document.body.appendChild(gate);
  }

  function buildPrimaryAccessAction(access) {
    const inviteCode = String(runtime.context.activity && runtime.context.activity.invite_code || '').trim();
    const search = new URLSearchParams();
    search.set('next', currentStudentPath());
    if (inviteCode) search.set('code', inviteCode);
    return {
      href: studentUrl(`/student?${search.toString()}`),
      label: access.activityReady && access.courseMatched !== false
        ? (access.isGuest ? '退出访客并以学生身份进入' : '以学生身份继续进入')
        : '前往学生入口'
    };
  }

  function currentStudentPath() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function normalizeEntryPath(path) {
    if (!path) return '';
    try {
      const url = new URL(String(path), location.origin);
      let normalizedPath = `${url.pathname}${url.search}`.replace(/\/+$/, match => match === '/' ? '/' : '');
      if (/^\/(?:economics|econ)(?:\/)?(?:\?.*)?$/i.test(normalizedPath)) {
        normalizedPath = '/courses/economics-fundamentals';
      }
      if (/^\/courses\/economics-fundamentals(?:\/)?(?:\?.*)?$/i.test(normalizedPath)) {
        normalizedPath = '/courses/economics-fundamentals';
      }
      return normalizedPath;
    } catch {
      return '';
    }
  }

  function isAssignedActivityEntry() {
    if (typeof getActivityEntryPath !== 'function') return false;
    const assigned = normalizeEntryPath(getActivityEntryPath());
    const current = normalizeEntryPath(currentStudentPath());
    return !!assigned && assigned === current;
  }

  function getAccessState() {
    const activityCourseName = String(runtime.context.activity && runtime.context.activity.course_name || '').trim();
    const activityReady = !!runtime.context.activity_id;
    const courseMatched =
      isAssignedActivityEntry()
      || !activityCourseName
      || normalizeCourseName(activityCourseName) === normalizeCourseName(COURSE_NAME);
    return {
      allowed: hasSuperAdminSession() || (hasTeacherSession() && courseMatched) || (hasLoggedInStudent() && courseMatched),
      activityReady,
      courseMatched,
      activityCourseName,
      isGuest: runtime.context.is_guest === true
    };
  }

  function normalizeCourseName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[《》]/g, '')
      .replace(/课程$/u, '');
  }

  function injectBridgeShell() {
    if (document.getElementById('classshow-econ-bridge')) return;
    const shell = document.createElement('section');
    shell.id = 'classshow-econ-bridge';
    shell.innerHTML = `
      <div class="classshow-econ-bridge-copy">
        <strong>ClassShow · ${escapeText(COURSE_NAME)}</strong>
        <small id="classshowEconIdentity">正在绑定课程上下文…</small>
        <div class="classshow-econ-chip-row" id="classshowEconChips"></div>
        <div class="classshow-econ-bridge-sync" id="classshowEconSync">未开始同步</div>
      </div>
      <div class="classshow-econ-actions">
        <button type="button" class="primary" id="classshowEconPortalBtn">返回课程总页</button>
        <button type="button" id="classshowEconIndexBtn">总门户</button>
        <button type="button" id="classshowEconModularBtn">模块版</button>
        <button type="button" id="classshowEconSaveBtn" style="display:none;">保存记录</button>
        <button type="button" id="classshowEconThemeBtn">亮色</button>
        <button type="button" id="classshowEconTeacherBtn" style="display:none;">教师后台</button>
      </div>
    `;
    document.body.appendChild(shell);

    document.getElementById('classshowEconPortalBtn').addEventListener('click', () => {
      if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.openPortal === 'function') {
        window.ClassShowCourseRuntime.openPortal(COURSE_NAME);
        return;
      }
      location.href = studentUrl(`/course.html?course=${encodeURIComponent(COURSE_NAME)}`);
    });
    document.getElementById('classshowEconIndexBtn').addEventListener('click', () => {
      if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.openIndex === 'function') {
        window.ClassShowCourseRuntime.openIndex();
        return;
      }
      location.href = studentUrl('/index.html');
    });
    document.getElementById('classshowEconModularBtn').addEventListener('click', () => {
      location.href = studentUrl(`/course-player.html?slug=${encodeURIComponent(COURSE_SLUG)}`);
    });
    document.getElementById('classshowEconSaveBtn').addEventListener('click', () => {
      saveStudyCheckpoint('manual_save', { manual: true, includeProgress: true }).catch(() => {});
    });
    document.getElementById('classshowEconThemeBtn').addEventListener('click', () => {
      if (typeof window.toggleTheme === 'function') {
        window.toggleTheme();
      }
    });
    document.getElementById('classshowEconTeacherBtn').addEventListener('click', () => {
      location.href = backendUrl('/teacher-dashboard.html');
    });
    if (typeof window.updateThemeButtons === 'function') {
      const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      window.updateThemeButtons(activeTheme);
    }
  }

  function updateBridgeShell() {
    const identityEl = document.getElementById('classshowEconIdentity');
    const chipsEl = document.getElementById('classshowEconChips');
    const syncEl = document.getElementById('classshowEconSync');
    const portalBtn = document.getElementById('classshowEconPortalBtn');
    const indexBtn = document.getElementById('classshowEconIndexBtn');
    const modularBtn = document.getElementById('classshowEconModularBtn');
    const saveBtn = document.getElementById('classshowEconSaveBtn');
    const themeBtn = document.getElementById('classshowEconThemeBtn');
    const teacherBtn = document.getElementById('classshowEconTeacherBtn');
    if (!identityEl || !chipsEl || !syncEl || !portalBtn || !indexBtn || !modularBtn || !saveBtn || !themeBtn || !teacherBtn) return;

    const activityName = runtime.context.activity && runtime.context.activity.activity_name
      ? runtime.context.activity.activity_name
      : '未绑定活动';
    const userName = runtime.context.user && runtime.context.user.name
      ? runtime.context.user.name
      : hasTeacherSession()
        ? '教师会话'
      : (runtime.context.is_guest ? '访客' : '设备自学');
    identityEl.textContent = `${userName} · ${activityName}`;

    const chips = [];
    chips.push(renderChip(
      runtime.context.activity_id ? '活动上下文已连接' : '仅设备自学模式',
      runtime.context.activity_id ? 'ok' : 'warn'
    ));
    if (hasLoggedInStudent()) {
      const pendingSeconds = pendingCloudSaveSeconds();
      chips.push(renderChip(`累计 ${formatStudyDuration(displayedStudyTotalSeconds())}`, 'ok'));
      chips.push(renderChip(
        pendingSeconds > 0 ? `待保存 ${formatStudyDuration(pendingSeconds)}` : '云端已保存',
        pendingSeconds > 0 ? 'warn' : 'ok'
      ));
      if (runtime.localStudy && runtime.localStudy.last_cloud_save_at) {
        chips.push(renderChip(`上次保存 ${formatClockTime(runtime.localStudy.last_cloud_save_at)}`, 'ok'));
      }
    } else if (runtime.context.is_guest) {
      chips.push(renderChip('访客模式不记录个人进度', 'warn'));
    } else {
      chips.push(renderChip('未登录，保留本地记录', 'warn'));
      chips.push(renderChip(localStudyIsActive() ? '当前学习中' : '当前未学习', localStudyIsActive() ? 'ok' : 'warn'));
    }
    if (runtime.teacherReady) {
      chips.push(renderChip('教师补充数据已解锁', 'ok'));
    } else if (runtime.teacherLoading) {
      chips.push(renderChip('教师补充数据加载中', 'warn'));
    } else if (hasTeacherSession()) {
      chips.push(renderChip('教师权限待验证', 'warn'));
    }

    chipsEl.innerHTML = chips.join('');
    syncEl.textContent = `进度同步：${runtime.syncLabel}`;
    syncEl.className = `classshow-econ-bridge-sync level-${runtime.syncLevel}`;
    const studentOnlyView = hasLoggedInStudent() && !hasPreviewAccess();
    portalBtn.style.display = studentOnlyView ? 'none' : '';
    indexBtn.style.display = studentOnlyView ? 'none' : '';
    modularBtn.style.display = studentOnlyView ? 'none' : '';
    saveBtn.style.display = hasLoggedInStudent() ? '' : 'none';
    saveBtn.disabled = runtime.cloudSaveBusy;
    saveBtn.textContent = runtime.cloudSaveBusy ? '保存中...' : (pendingCloudSaveSeconds() > 0 ? '保存记录' : '已保存');
    teacherBtn.style.display = hasTeacherSession() ? '' : 'none';
  }

  function renderChip(label, level) {
    return `<span class="classshow-econ-chip ${level || ''}">${escapeText(label)}</span>`;
  }

  function hasTeacherSession() {
    return !!sessionStorage.getItem('teacherToken') && !!runtime.context.activity_id;
  }

  function hasLoggedInStudent() {
    return !!runtime.context.activity_id
      && !!runtime.context.user
      && !!runtime.context.user.id
      && !runtime.context.is_guest
      && !runtime.context.user._guest;
  }

  function hasSuperAdminSession() {
    return !!sessionStorage.getItem('superAdminToken');
  }

  function hasPreviewAccess() {
    return hasTeacherSession() || hasSuperAdminSession();
  }

  async function syncActivityContextFromBackend() {
    const inviteCode = String(runtime.context.activity && runtime.context.activity.invite_code || '').trim();
    if (!inviteCode || typeof api !== 'function') {
      if (typeof window.refreshEconomicsModuleLocks === 'function') {
        window.refreshEconomicsModuleLocks();
      }
      return;
    }

    try {
      const latest = await api(`/activities/code/${encodeURIComponent(inviteCode)}`);
      if (!latest || !latest.id) return;
      runtime.context = {
        ...runtime.context,
        activity: latest,
        activity_id: runtime.context.activity_id || latest.id || ''
      };
      sessionStorage.setItem('classshow_activity', JSON.stringify(latest));
      if (typeof setActivityId === 'function' && latest.id) {
        setActivityId(latest.id);
      }
      window.dispatchEvent(new CustomEvent('classshow:econ-activity-refreshed', {
        detail: latest
      }));
    } catch (error) {
      console.warn('Failed to refresh economics activity context:', error);
    } finally {
      if (typeof window.refreshEconomicsModuleLocks === 'function') {
        window.refreshEconomicsModuleLocks();
      }
      updateBridgeShell();
    }
  }

function updateBridgeShell() {
    const identityEl = document.getElementById('classshowEconIdentity');
    const chipsEl = document.getElementById('classshowEconChips');
    const syncEl = document.getElementById('classshowEconSync');
    const portalBtn = document.getElementById('classshowEconPortalBtn');
    const indexBtn = document.getElementById('classshowEconIndexBtn');
    const modularBtn = document.getElementById('classshowEconModularBtn');
    const saveBtn = document.getElementById('classshowEconSaveBtn');
    const themeBtn = document.getElementById('classshowEconThemeBtn');
    const teacherBtn = document.getElementById('classshowEconTeacherBtn');
    if (!identityEl || !chipsEl || !syncEl || !portalBtn || !indexBtn || !modularBtn || !saveBtn || !themeBtn || !teacherBtn) return;

    const activityName = runtime.context.activity && runtime.context.activity.activity_name
      ? runtime.context.activity.activity_name
      : '当前未绑定活动';
    const userName = runtime.context.user && runtime.context.user.name
      ? runtime.context.user.name
      : hasTeacherSession()
        ? '教师预览'
      : hasSuperAdminSession()
        ? '超级管理员预览'
      : (runtime.context.is_guest ? '访客' : '未登录');
    identityEl.textContent = `${userName} · ${activityName}`;

    const chips = [];
    chips.push(renderChip(
      runtime.context.activity_id ? '活动上下文已连接' : '未绑定活动',
      runtime.context.activity_id ? 'ok' : 'warn'
    ));
    if (hasLoggedInStudent()) {
      const pendingSeconds = pendingCloudSaveSeconds();
      chips.push(renderChip(`累计 ${formatStudyDuration(displayedStudyTotalSeconds())}`, 'ok'));
      chips.push(renderChip(
        pendingSeconds > 0 ? `待保存 ${formatStudyDuration(pendingSeconds)}` : '云端已保存',
        pendingSeconds > 0 ? 'warn' : 'ok'
      ));
      if (runtime.localStudy && runtime.localStudy.last_cloud_save_at) {
        chips.push(renderChip(`上次保存 ${formatClockTime(runtime.localStudy.last_cloud_save_at)}`, 'ok'));
      }
    } else if (hasPreviewAccess()) {
      chips.push(renderChip(hasTeacherSession() ? '教师预览' : '超级管理员预览', 'warn'));
      chips.push(renderChip('预览模式不记录学生学习数据', 'warn'));
    } else if (runtime.context.is_guest) {
      chips.push(renderChip('访客模式不记录个人进度', 'warn'));
    } else {
      chips.push(renderChip('未登录，保留本地记录', 'warn'));
      chips.push(renderChip(localStudyIsActive() ? '当前学习中' : '当前未学习', localStudyIsActive() ? 'ok' : 'warn'));
    }
    if (runtime.teacherReady) {
      chips.push(renderChip('教师补充数据已解锁', 'ok'));
    } else if (runtime.teacherLoading) {
      chips.push(renderChip('教师补充数据加载中', 'warn'));
    } else if (hasTeacherSession()) {
      chips.push(renderChip('教师权限待验证', 'warn'));
    }

    chipsEl.innerHTML = chips.join('');
    syncEl.textContent = `进度同步：${runtime.syncLabel}`;
    syncEl.className = `classshow-econ-bridge-sync level-${runtime.syncLevel}`;
    const studentOnlyView = hasLoggedInStudent() && !hasPreviewAccess();
    portalBtn.style.display = studentOnlyView ? 'none' : '';
    indexBtn.style.display = studentOnlyView ? 'none' : '';
    modularBtn.style.display = studentOnlyView ? 'none' : '';
    saveBtn.style.display = hasLoggedInStudent() ? '' : 'none';
    saveBtn.disabled = runtime.cloudSaveBusy;
    saveBtn.textContent = runtime.cloudSaveBusy ? '保存中...' : (pendingCloudSaveSeconds() > 0 ? '保存记录' : '已保存');
    teacherBtn.style.display = hasTeacherSession() ? '' : 'none';
  }

  function hideTeacherEntrypoints() {
    runtime.teacherEntrypoints = Array.from(document.querySelectorAll([
      '[onclick*="toggleTeacherMode"]',
      '[onclick*="toggleTeacherQuestions"]',
      '#teacher-btn'
    ].join(',')));
    runtime.teacherEntrypoints.forEach(node => {
      if (!node.dataset.classshowOriginalDisplay) {
        node.dataset.classshowOriginalDisplay = node.style.display || '';
      }
      node.style.display = 'none';
    });
  }

  function showTeacherEntrypoints() {
    runtime.teacherEntrypoints.forEach(node => {
      node.style.display = node.dataset.classshowOriginalDisplay || '';
    });
  }

  function patchCourseBridge() {
    const original = runtime.originalBridge;
    window.EconCourseBridge = {
      ...original,
      mode: 'classshow-runtime',
      onProgressUpdate(data) {
        safeCall(original.onProgressUpdate, window, data);
        scheduleProgressSync(data && data.event ? data.event : 'progress_update');
      },
      onQuizSubmit(data) {
        safeCall(original.onQuizSubmit, window, data);
        scheduleProgressSync(data && data.correct === false ? 'quiz_incorrect' : 'quiz_submit');
        saveStudyCheckpoint(data && data.correct === false ? 'quiz_incorrect' : 'quiz_submit', {
          automatic: true,
          includeProgress: true,
          silent: true
        }).catch(() => {});
      },
      onReflectionSubmit(data) {
        safeCall(original.onReflectionSubmit, window, data);
        scheduleProgressSync(data && data.event ? data.event : 'reflection_submit');
        saveStudyCheckpoint(data && data.event ? data.event : 'reflection_submit', {
          automatic: true,
          includeProgress: true,
          silent: true
        }).catch(() => {});
      },
      onExperimentComplete(data) {
        safeCall(original.onExperimentComplete, window, data);
        scheduleProgressSync(data && data.event ? data.event : 'experiment_complete');
        saveStudyCheckpoint(data && data.event ? data.event : 'experiment_complete', {
          automatic: true,
          includeProgress: true,
          silent: true
        }).catch(() => {});
      },
      onTeacherModeChange(data) {
        safeCall(original.onTeacherModeChange, window, data);
        runtime.syncLabel = data && data.teacherMode ? '教师模式已切换' : runtime.syncLabel;
        updateBridgeShell();
      }
    };
  }

  function patchAiControls() {
    const originalSwitchAiMode = typeof window.switchAiMode === 'function' ? window.switchAiMode : null;
    const originalSaveApiKey = typeof window.saveApiKey === 'function' ? window.saveApiKey : null;

    window.switchAiMode = function patchedSwitchAiMode(mode) {
      if (String(mode || '').toLowerCase() !== 'local') {
        forceLocalAiMode();
        notify('教师 Live AI 将在服务端代理接入后启用，当前保留离线启发式模式。', 'error');
        if (typeof window.resetAiChat === 'function') window.resetAiChat();
        return;
      }
      if (originalSwitchAiMode) {
        originalSwitchAiMode('local');
      } else {
        forceLocalAiMode();
      }
    };

    window.saveApiKey = function patchedSaveApiKey() {
      sessionStorage.removeItem(AI_KEY_KEY);
      if (originalSaveApiKey) originalSaveApiKey('');
      notify('浏览器端 API Key 存储已停用，后续将切到教师服务端代理。', 'error');
    };
  }

  function patchAppRuntime() {
    const app = window.EconCourseApp;
    if (!app || !app.storage || !app.ui || runtime.appPatched) return;
    runtime.appPatched = true;

    runtime.originalStorageLoad = app.storage.load.bind(app.storage);
    runtime.originalStorageSave = app.storage.save.bind(app.storage);
    runtime.originalStorageReset = app.storage.reset.bind(app.storage);
    runtime.originalToggleTeacherMode = app.ui.toggleTeacherMode.bind(app.ui);

    app.lp = function patchedLp() {
      const snapshot = {};
      PROGRESS_STATE_KEYS.forEach(key => {
        snapshot[key] = cloneValue(this.state[key]);
      });
      return snapshot;
    };

    app.sp = function patchedSp(nextState) {
      const incoming = nextState && typeof nextState === 'object' ? nextState : {};
      Object.entries(incoming).forEach(([key, value]) => {
        this.state[key] = cloneValue(value);
      });
      this.storage.save();
    };

    app.storage.load = function patchedLoad() {
      runtime.originalStorageLoad();
      const meta = app.state.classshowMeta && typeof app.state.classshowMeta === 'object'
        ? app.state.classshowMeta
        : {};
      app.state.classshowMeta = {
        ...meta,
        course_slug: COURSE_SLUG,
        last_local_update_at: meta.last_local_update_at || '',
        last_remote_sync_at: meta.last_remote_sync_at || '',
        learning_channel: hasLoggedInStudent() ? 'classshow-activity' : 'device-selflearn'
      };
      app.state.teacherMode = false;
      if (app.state.learningMode === 'teacher') {
        app.state.learningMode = 'classroom';
      }
    };

    app.storage.save = function patchedSave() {
      const meta = app.state.classshowMeta && typeof app.state.classshowMeta === 'object'
        ? app.state.classshowMeta
        : {};
      app.state.classshowMeta = {
        ...meta,
        course_slug: COURSE_SLUG,
        last_local_update_at: new Date().toISOString(),
        learning_channel: hasLoggedInStudent() ? 'classshow-activity' : 'device-selflearn'
      };
      runtime.originalStorageSave();
      if (!runtime.hydrating) {
        recordLocalStudy('state_save');
        if (!hasLoggedInStudent()) {
          runtime.syncLabel = '本地进度已保存';
          runtime.syncLevel = 'ok';
          updateBridgeShell();
        }
        scheduleProgressSync('state_save');
      }
    };

    app.storage.reset = function patchedReset() {
      if (!confirm('确定要重置当前设备上的经济学课程学习记录吗？')) return;
      const localKeys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(ECON_SESSION_KEY_PREFIX)) localKeys.push(key);
      }
      localKeys.forEach(key => localStorage.removeItem(key));

      const sessionKeys = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(ECON_SESSION_KEY_PREFIX)) sessionKeys.push(key);
      }
      sessionKeys.forEach(key => sessionStorage.removeItem(key));

      scheduleProgressSync('reset');
      alert('当前设备上的经济学课程本地记录已清空，ClassShow 活动身份不会被移除。');
      location.reload();
    };

    app.ui.toggleTeacherMode = function patchedToggleTeacherMode() {
      if (runtime.teacherReady) {
        runtime.originalToggleTeacherMode();
        updateBridgeShell();
        return;
      }
      bootstrapTeacherSupplement(true);
    };
  }

  function scheduleTeacherBootstrap() {
    if (!hasTeacherSession()) {
      updateBridgeShell();
      return;
    }
    bootstrapTeacherSupplement(wantsTeacherMode);
  }

  function scheduleRemoteHydration() {
    if (!hasLoggedInStudent()) return;
    const run = () => {
      hydrateRemoteLearningSummary()
        .catch(() => null)
        .finally(() => {
          hydrateRemoteProgress().catch(() => null);
        });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
      return;
    }
    run();
  }

  async function bootstrapTeacherSupplement(autoOpen) {
    if (runtime.teacherReady) {
      if (autoOpen && runtime.originalToggleTeacherMode && window.EconCourseApp && !window.EconCourseApp.state.teacherMode) {
        runtime.originalToggleTeacherMode();
      }
      return true;
    }
    if (runtime.teacherLoading) return false;
    if (!hasTeacherSession()) {
      notify('教师模式需要从已登录的教师后台进入当前活动。', 'error');
      return false;
    }

    runtime.teacherLoading = true;
    runtime.teacherError = '';
    runtime.syncLabel = '验证教师权限…';
    runtime.syncLevel = 'warn';
    updateBridgeShell();

    try {
      const result = await api(`/teacher/course-assets/${encodeURIComponent(COURSE_SLUG)}/supplement?activity_id=${encodeURIComponent(runtime.context.activity_id)}`);
      mergeTeacherSupplement(result && result.supplement ? result.supplement : {});
      runtime.teacherReady = true;
      runtime.teacherLoadedAt = result && result.updated_at ? result.updated_at : new Date().toISOString();
      runtime.syncLabel = '教师补充数据已加载';
      runtime.syncLevel = 'ok';
      showTeacherEntrypoints();
      updateBridgeShell();

      if (autoOpen && runtime.originalToggleTeacherMode && window.EconCourseApp && !window.EconCourseApp.state.teacherMode) {
        runtime.originalToggleTeacherMode();
      }
      return true;
    } catch (error) {
      runtime.teacherError = error && error.message ? error.message : '教师补充数据加载失败';
      runtime.syncLabel = runtime.teacherError;
      runtime.syncLevel = 'err';
      updateBridgeShell();
      notify(runtime.teacherError, 'error');
      return false;
    } finally {
      runtime.teacherLoading = false;
    }
  }

  function mergeTeacherSupplement(supplement) {
    if (!window.C || !supplement || typeof supplement !== 'object') return;
    Object.entries(supplement).forEach(([chapterId, payload]) => {
      if (!window.C[chapterId] || !payload) return;
      mergeTeacherNode(window.C[chapterId], payload);
    });
  }

  function mergeTeacherNode(target, supplement) {
    if (!target || !supplement) return;
    if (Array.isArray(target) && Array.isArray(supplement)) {
      supplement.forEach((item, index) => {
        if (target[index] == null) {
          target[index] = cloneValue(item);
          return;
        }
        mergeTeacherNode(target[index], item);
      });
      return;
    }
    if (typeof target !== 'object' || typeof supplement !== 'object') return;
    Object.entries(supplement).forEach(([key, value]) => {
      if (key === 'teacherAnswer' || key === 'boardAnswer' || key === 'teacherQuestions') {
        target[key] = cloneValue(value);
        return;
      }
      if (Array.isArray(value)) {
        if (!Array.isArray(target[key])) target[key] = [];
        mergeTeacherNode(target[key], value);
        return;
      }
      if (value && typeof value === 'object') {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        mergeTeacherNode(target[key], value);
        return;
      }
      target[key] = value;
    });
  }

  async function hydrateRemoteProgress() {
    const app = window.EconCourseApp;
    if (!app || !hasLoggedInStudent()) return;

    try {
      const result = await api(`/student/course-runtime/progress?activity_id=${encodeURIComponent(runtime.context.activity_id)}&user_id=${encodeURIComponent(runtime.context.user.id)}&course_slug=${encodeURIComponent(COURSE_SLUG)}`);
      if (!result || result.schema_ready === false || !result.progress || !result.progress.snapshot) {
        if (result && result.schema_ready === false) {
          runtime.syncLabel = '数据库未启用课程进度表';
          runtime.syncLevel = 'warn';
          updateBridgeShell();
        }
        return;
      }

      const remoteProgress = result.progress;
      const remoteTimestamp = remoteProgress.client_updated_at || remoteProgress.updated_at || '';
      const localTimestamp = app.state.classshowMeta && app.state.classshowMeta.last_local_update_at
        ? app.state.classshowMeta.last_local_update_at
        : '';

      if (hasMeaningfulLocalProgress(app.state) && localTimestamp && remoteTimestamp) {
        const localTime = new Date(localTimestamp).getTime();
        const remoteTime = new Date(remoteTimestamp).getTime();
        if (Number.isFinite(localTime) && Number.isFinite(remoteTime) && localTime >= remoteTime) {
          runtime.syncLabel = '本地进度较新';
          runtime.syncLevel = 'ok';
          updateBridgeShell();
          return;
        }
      }

      runtime.hydrating = true;
      REMOTE_SNAPSHOT_KEYS.forEach(key => {
        if (key in remoteProgress.snapshot) {
          app.state[key] = cloneValue(remoteProgress.snapshot[key]);
        }
      });
      app.state.classshowMeta = {
        ...(app.state.classshowMeta || {}),
        course_slug: COURSE_SLUG,
        last_local_update_at: remoteTimestamp || new Date().toISOString(),
        last_remote_sync_at: remoteProgress.updated_at || new Date().toISOString(),
        learning_channel: 'classshow-activity'
      };
      runtime.originalStorageSave();
      refreshCourseViews();
      recordLocalStudy('remote_hydrate');
      runtime.syncLabel = '已恢复云端进度';
      runtime.syncLevel = 'ok';
      updateBridgeShell();
    } catch (error) {
      runtime.syncLabel = error && error.message ? error.message : '进度恢复失败';
      runtime.syncLevel = 'warn';
      updateBridgeShell();
    } finally {
      runtime.hydrating = false;
    }
  }

  async function hydrateRemoteLearningSummary() {
    if (!hasLoggedInStudent()) return;
    try {
      const summary = await api(`/student/learning/summary?activity_id=${encodeURIComponent(runtime.context.activity_id)}&user_id=${encodeURIComponent(runtime.context.user.id)}`);
      if (!summary || summary.schema_ready === false) return;
      const stats = normalizeLocalStudyStats(runtime.localStudy || readLocalStudyStats(runtime.context));
      const remoteTotal = Math.max(0, Number(summary && summary.my && summary.my.active_seconds || 0));
      stats.summary_total_seconds = Math.max(remoteTotal, Number(stats.summary_total_seconds || 0));
      runtime.localStudy = stats;
      writeLocalStudyStats(stats, runtime.context);
      updateBridgeShell();
    } catch (error) {
      console.warn('Failed to hydrate learning summary:', error);
    }
  }

  function maybePromptCloudSave(stats = runtime.localStudy) {
    if (!hasLoggedInStudent()) return;
    const pendingSeconds = pendingCloudSaveSeconds(stats);
    if (pendingSeconds < CLOUD_SAVE_REMINDER_MS / 1000) return;
    const lastPromptAt = stats && stats.last_prompt_at ? new Date(stats.last_prompt_at).getTime() : 0;
    const now = Date.now();
    if (Number.isFinite(lastPromptAt) && lastPromptAt > 0 && now - lastPromptAt < CLOUD_SAVE_REMINDER_MS) return;
    const nextStats = normalizeLocalStudyStats(stats);
    nextStats.last_prompt_at = new Date(now).toISOString();
    runtime.localStudy = nextStats;
    writeLocalStudyStats(nextStats, runtime.context);
    runtime.syncLabel = `已累计 ${formatStudyDuration(pendingSeconds)} 未保存`;
    runtime.syncLevel = 'warn';
    updateBridgeShell();
    notify(`已累计 ${formatStudyDuration(pendingSeconds)} 未保存，点击顶部“保存记录”同步到云端。`, 'error');
  }

  async function saveStudyCheckpoint(reason, options = {}) {
    if (!hasLoggedInStudent() || runtime.cloudSaveBusy) return false;
    const stats = recordLocalStudy(reason || 'manual_save', {
      active: typeof options.active === 'boolean' ? options.active : !document.hidden,
      startSession: !!options.startSession
    });
    const pendingSeconds = pendingCloudSaveSeconds(stats);
    const shouldSyncProgress = !!options.includeProgress && (runtime.progressDirty || options.forceProgress);
    if (pendingSeconds <= 0 && !shouldSyncProgress) {
      runtime.syncLabel = '云端已保存';
      runtime.syncLevel = 'ok';
      updateBridgeShell();
      return true;
    }

    runtime.cloudSaveBusy = true;
    runtime.syncLabel = options.manual ? '正在保存记录…' : '正在保存学习记录…';
    runtime.syncLevel = 'warn';
    updateBridgeShell();

    try {
      const result = await api('/student/learning/heartbeat', {
        method: 'POST',
        keepalive: !!options.keepalive,
        body: JSON.stringify({
          activity_id: runtime.context.activity_id,
          user_id: runtime.context.user.id,
          session_token: getLearningSessionToken(),
          page_path: location.pathname,
          active: typeof options.active === 'boolean' ? options.active : !document.hidden,
          course_slug: COURSE_SLUG,
          last_event: reason || 'manual_save',
          client_total_seconds: stats.total_seconds
        })
      });

      if (result && result.schema_ready === false) {
        runtime.syncLabel = '数据库未启用学习时长表';
        runtime.syncLevel = 'warn';
        updateBridgeShell();
        return false;
      }

      stats.cloud_total_seconds = Math.max(0, Number(result && result.total_seconds || stats.total_seconds));
      stats.summary_total_seconds = Math.max(
        summaryCloudTotalSeconds(stats) + Math.max(0, Number(result && result.added_seconds || 0)),
        stats.cloud_total_seconds
      );
      stats.last_cloud_save_at = new Date().toISOString();
      runtime.localStudy = normalizeLocalStudyStats(stats);
      writeLocalStudyStats(runtime.localStudy, runtime.context);

      if (shouldSyncProgress) {
        await syncProgress(reason || 'checkpoint', {
          force: true,
          silent: true,
          keepalive: !!options.keepalive
        });
      }

      runtime.syncLabel = '学习记录已保存到云端';
      runtime.syncLevel = 'ok';
      updateBridgeShell();
      if (options.manual) notify('本次学习记录已保存。', 'success');
      return true;
    } catch (error) {
      runtime.syncLabel = error && error.message ? error.message : '学习记录保存失败';
      runtime.syncLevel = 'err';
      updateBridgeShell();
      if (options.manual) notify(runtime.syncLabel, 'error');
      return false;
    } finally {
      runtime.cloudSaveBusy = false;
      updateBridgeShell();
    }
  }

  function startLearningHeartbeat() {
    if (hasPreviewAccess()) {
      runtime.syncLabel = '预览模式不记录学生学习时长';
      runtime.syncLevel = 'warn';
      updateBridgeShell();
      return;
    }
    recordLocalStudy('page_open', { startSession: true });
    if (hasLoggedInStudent()) {
      runtime.syncLabel = '本地已开始记录，等待保存到云端';
      runtime.syncLevel = 'warn';
    } else {
      runtime.syncLabel = '本地自学记录中';
      runtime.syncLevel = document.hidden ? 'warn' : 'ok';
    }
    updateBridgeShell();

    runtime.heartbeatTimer = window.setInterval(() => {
      const stats = recordLocalStudy('local_tick');
      maybePromptCloudSave(stats);
    }, LOCAL_STUDY_TICK_MS);

    document.addEventListener('visibilitychange', () => {
      recordLocalStudy(document.hidden ? 'page_hidden' : 'page_visible');
      if (document.hidden) {
        saveStudyCheckpoint('page_hidden', {
          automatic: true,
          includeProgress: true,
          silent: true,
          keepalive: true,
          active: false
        }).catch(() => {});
      }
    });

    window.addEventListener('pagehide', () => {
      if (runtime.heartbeatTimer) window.clearInterval(runtime.heartbeatTimer);
      recordLocalStudy('page_unload', { active: false });
      saveStudyCheckpoint('page_unload', {
        automatic: true,
        includeProgress: true,
        silent: true,
        keepalive: true,
        active: false
      }).catch(() => {});
    });
  }

  function scheduleProgressSync(reason) {
    if (!window.EconCourseApp || runtime.hydrating) return;
    runtime.syncReason = reason || 'state_change';
    runtime.progressDirty = true;
    if (hasLoggedInStudent()) {
      runtime.syncLabel = '本地进度已更新，等待保存';
      runtime.syncLevel = 'warn';
    }
    if (runtime.syncTimer) window.clearTimeout(runtime.syncTimer);
    runtime.syncTimer = window.setTimeout(() => {
      runtime.syncTimer = null;
      updateBridgeShell();
    }, PROGRESS_SYNC_DEBOUNCE_MS);
  }

  async function syncProgress(reason, options = {}) {
    if (!hasLoggedInStudent() || !window.EconCourseApp || runtime.syncBusy) return false;
    if (!runtime.progressDirty && !options.force) return true;
    runtime.syncBusy = true;
    if (!options.silent) {
      runtime.syncLabel = `同步中 · ${reason}`;
      runtime.syncLevel = 'warn';
      updateBridgeShell();
    }

    try {
      const payload = buildProgressPayload(reason);
      const result = await api('/student/course-runtime/progress', {
        method: 'POST',
        keepalive: !!options.keepalive,
        body: JSON.stringify(payload)
      });

      if (result && result.schema_ready === false) {
        if (!options.silent) {
          runtime.syncLabel = '数据库未启用课程进度表';
          runtime.syncLevel = 'warn';
        }
      } else {
        const app = window.EconCourseApp;
        app.state.classshowMeta = {
          ...(app.state.classshowMeta || {}),
          course_slug: COURSE_SLUG,
          last_remote_sync_at: result && result.progress && result.progress.updated_at
            ? result.progress.updated_at
            : new Date().toISOString()
        };
        runtime.progressDirty = false;
        if (!options.silent) {
          runtime.syncLabel = '进度已记录到 ClassShow';
          runtime.syncLevel = 'ok';
        }
      }
      return true;
    } catch (error) {
      if (!options.silent) {
        runtime.syncLabel = error && error.message ? error.message : '进度同步失败';
        runtime.syncLevel = 'err';
      }
      return false;
    } finally {
      runtime.syncBusy = false;
      if (!options.silent) updateBridgeShell();
    }
  }

  function buildProgressPayload(reason) {
    const app = window.EconCourseApp;
    const state = app.state || {};
    const summary = summarizeProgressState(state);
    const snapshot = {};
    REMOTE_SNAPSHOT_KEYS.forEach(key => {
      snapshot[key] = cloneValue(state[key]);
    });

    return {
      activity_id: runtime.context.activity_id,
      user_id: runtime.context.user.id,
      course_slug: COURSE_SLUG,
      runtime_version: app.version || state.version || 'economics-course',
      learning_mode: summary.learningMode,
      current_chapter: summary.currentChapter,
      current_lesson: summary.currentLesson,
      current_stage: summary.currentStage,
      progress_percent: summary.progressPercent,
      completed_chapters: summary.completedChapters,
      total_chapters: summary.totalChapters,
      xp: summary.xp,
      active: !document.hidden,
      last_event: reason || 'state_change',
      page_path: location.pathname,
      client_updated_at: state.classshowMeta && state.classshowMeta.last_local_update_at
        ? state.classshowMeta.last_local_update_at
        : new Date().toISOString(),
      snapshot
    };
  }

  function refreshCourseViews() {
    safeCall(window.rTabs);
    safeCall(window.rMods);
    safeCall(window.rSecs);
    safeCall(window.rProg);
    safeCall(window.renderIndex);
    safeCall(window.renderAdvanced);
    safeCall(window.renderHSGuide);
    safeCall(window.renderTribulationPanel);
    if (window.EconCourseApp && window.EconCourseApp.ui) {
      safeCall(window.EconCourseApp.ui.renderCurrentTaskPanel, window.EconCourseApp.ui);
      safeCall(window.EconCourseApp.ui.updateNavbarButtons, window.EconCourseApp.ui);
      if (window.EconCourseApp.state.teacherMode) {
        safeCall(window.EconCourseApp.ui.renderTeacherPanel, window.EconCourseApp.ui);
      }
    }
    safeCall(window.resetAiChat);
  }

  function forceLocalAiMode() {
    sessionStorage.setItem(AI_MODE_KEY, 'local');
    sessionStorage.removeItem(AI_KEY_KEY);
  }

  function getLearningSessionToken() {
    const storageKey = getLearningSessionStorageKey(runtime.context);
    let token = '';
    try {
      token = localStorage.getItem(storageKey) || '';
    } catch {}
    if (!token) {
      token = makeSessionToken();
      try {
        localStorage.setItem(storageKey, token);
      } catch {}
    }
    return token;
  }

  function makeSessionToken() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `learn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function getLearningSessionStorageKey(context = runtime.context) {
    const activityId = String(context && (context.activity_id || context.activity && context.activity.id) || 'local').trim() || 'local';
    const userId = String(context && context.user && context.user.id || 'anon').trim() || 'anon';
    return `${LEARNING_SESSION_KEY}::${COURSE_SLUG}::${activityId}::${userId}`;
  }

  function getLocalStudyStorageKey(context = runtime.context) {
    const activityId = String(context && (context.activity_id || context.activity && context.activity.id) || 'local').trim() || 'local';
    const userId = String(context && context.user && context.user.id || 'anon').trim() || 'anon';
    return `${LOCAL_STUDY_STATS_KEY}::${COURSE_SLUG}::${activityId}::${userId}`;
  }

  function readLocalStudyStats(context = runtime.context) {
    try {
      const scopedRaw = localStorage.getItem(getLocalStudyStorageKey(context));
      if (scopedRaw) return normalizeLocalStudyStats(JSON.parse(scopedRaw));
      const legacyRaw = localStorage.getItem(LEGACY_LOCAL_STUDY_STATS_KEY);
      return normalizeLocalStudyStats(legacyRaw ? JSON.parse(legacyRaw) : null);
    } catch {
      return normalizeLocalStudyStats(null);
    }
  }

  function writeLocalStudyStats(stats, context = runtime.context) {
    try {
      localStorage.setItem(getLocalStudyStorageKey(context), JSON.stringify(normalizeLocalStudyStats(stats)));
    } catch {}
  }

  function normalizeLocalStudyStats(value) {
    const stats = value && typeof value === 'object' ? value : {};
    return {
      session_token: typeof stats.session_token === 'string' ? stats.session_token : '',
      total_seconds: Math.max(0, Number(stats.total_seconds || 0)),
      cloud_total_seconds: Math.max(0, Number(stats.cloud_total_seconds || 0)),
      summary_total_seconds: Math.max(0, Number(stats.summary_total_seconds || 0)),
      session_count: Math.max(0, Number(stats.session_count || 0)),
      active: stats.active === true,
      started_at: typeof stats.started_at === 'string' ? stats.started_at : '',
      last_seen_at: typeof stats.last_seen_at === 'string' ? stats.last_seen_at : '',
      updated_at: typeof stats.updated_at === 'string' ? stats.updated_at : '',
      last_cloud_save_at: typeof stats.last_cloud_save_at === 'string' ? stats.last_cloud_save_at : '',
      last_prompt_at: typeof stats.last_prompt_at === 'string' ? stats.last_prompt_at : '',
      last_event: typeof stats.last_event === 'string' ? stats.last_event : '',
      page_path: typeof stats.page_path === 'string' ? stats.page_path : location.pathname,
      learning_mode: typeof stats.learning_mode === 'string' ? stats.learning_mode : 'selflearn',
      current_chapter: Math.max(0, Number(stats.current_chapter || 0)),
      current_lesson: Math.max(0, Number(stats.current_lesson || 0)),
      current_stage: typeof stats.current_stage === 'string' ? stats.current_stage : '',
      progress_percent: Math.max(0, Number(stats.progress_percent || 0)),
      completed_chapters: Math.max(0, Number(stats.completed_chapters || 0)),
      total_chapters: Math.max(0, Number(stats.total_chapters || 0)),
      xp: Math.max(0, Number(stats.xp || 0))
    };
  }

  function recordLocalStudy(reason, options = {}) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const stats = normalizeLocalStudyStats(runtime.localStudy || readLocalStudyStats(runtime.context));
    const active = typeof options.active === 'boolean' ? options.active : !document.hidden;
    const lastSeenMs = stats.last_seen_at ? new Date(stats.last_seen_at).getTime() : 0;

    if (Number.isFinite(lastSeenMs) && lastSeenMs > 0 && stats.active) {
      const deltaSeconds = Math.max(0, Math.floor((now - lastSeenMs) / 1000));
      stats.total_seconds += Math.min(deltaSeconds, LOCAL_STUDY_MAX_DELTA_SECONDS);
    }

    if (options.startSession || stats.session_token !== runtime.localStudySessionToken) {
      stats.session_count += 1;
      stats.session_token = runtime.localStudySessionToken;
      stats.started_at = nowIso;
    }

    const summary = summarizeProgressState(window.EconCourseApp && window.EconCourseApp.state
      ? window.EconCourseApp.state
      : {});

    stats.active = active;
    stats.last_seen_at = nowIso;
    stats.updated_at = nowIso;
    stats.last_event = reason || 'heartbeat';
    stats.page_path = location.pathname;
    stats.learning_mode = summary.learningMode;
    stats.current_chapter = summary.currentChapter;
    stats.current_lesson = summary.currentLesson;
    stats.current_stage = summary.currentStage;
    stats.progress_percent = summary.progressPercent;
    stats.completed_chapters = summary.completedChapters;
    stats.total_chapters = summary.totalChapters;
    stats.xp = summary.xp;

    runtime.localStudy = stats;
    writeLocalStudyStats(stats, runtime.context);

    if (!hasLoggedInStudent()) {
      runtime.syncLabel = active ? '本地自学记录中' : '本地自学已暂停';
      runtime.syncLevel = active ? 'ok' : 'warn';
    } else {
      runtime.syncLabel = pendingCloudSaveSeconds(stats) > 0
        ? '本地已记录，等待保存到云端'
        : (runtime.progressDirty ? '本地进度待保存' : '云端已保存');
      runtime.syncLevel = pendingCloudSaveSeconds(stats) > 0 || runtime.progressDirty ? 'warn' : 'ok';
    }

    updateBridgeShell();
    return stats;
  }

  function summarizeProgressState(state) {
    const safeState = state && typeof state === 'object' ? state : {};
    const totalChapters = Math.max(0, Object.keys(window.C || {}).length);
    const completedChapters = Math.max(
      Object.keys(safeState.completedChapters || {}).length,
      Object.values(safeState.chapterProgress || {}).filter(item =>
        item && (item.quizDone || item.challengeDone || item.reflectionDone || item.viewed)
      ).length
    );
    const progressPercent = totalChapters > 0
      ? Math.min(100, Math.round((completedChapters / totalChapters) * 10000) / 100)
      : 0;

    return {
      totalChapters,
      completedChapters,
      progressPercent,
      currentChapter: Math.max(0, Number(safeState.currentChapter || safeState.currentActiveChapter || 0)),
      currentLesson: Math.max(0, Number(safeState.currentLesson || 0)),
      currentStage: safeState.currentStage || '',
      xp: Math.max(0, Number(safeState.xp || 0)),
      learningMode: safeState.learningMode || 'selflearn'
    };
  }

  function localStudyTotalSeconds() {
    return Math.max(0, Number(runtime.localStudy && runtime.localStudy.total_seconds || 0));
  }

  function localStudyTotalSecondsFor(stats) {
    return Math.max(0, Number(stats && stats.total_seconds || 0));
  }

  function savedCloudTotalSeconds(stats = runtime.localStudy) {
    return Math.max(0, Number(stats && stats.cloud_total_seconds || 0));
  }

  function summaryCloudTotalSeconds(stats = runtime.localStudy) {
    return Math.max(0, Number(stats && stats.summary_total_seconds || 0));
  }

  function pendingCloudSaveSeconds(stats = runtime.localStudy) {
    return Math.max(0, localStudyTotalSecondsFor(stats) - savedCloudTotalSeconds(stats));
  }

  function displayedStudyTotalSeconds() {
    return Math.max(summaryCloudTotalSeconds(), savedCloudTotalSeconds()) + pendingCloudSaveSeconds();
  }

  function localStudyIsActive() {
    return !!(runtime.localStudy && runtime.localStudy.active);
  }

  function formatStudyDuration(totalSeconds) {
    const minutes = Math.max(0, Math.floor(Number(totalSeconds || 0) / 60));
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours} 小时 ${remainingMinutes} 分`
      : `${hours} 小时`;
  }

  function formatClockTime(value) {
    if (!value) return '--:--';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '--:--';
    return date.toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function hasMeaningfulLocalProgress(state) {
    if (!state || typeof state !== 'object') return false;
    if (Number(state.xp || 0) > 0) return true;
    if (Object.keys(state.done || {}).length > 0) return true;
    if (Object.keys(state.chapterProgress || {}).length > 0) return true;
    if (Array.isArray(state.wrongQuestions) && state.wrongQuestions.length > 0) return true;
    if (Object.keys(state.reflections || {}).length > 0) return true;
    return false;
  }

  function cloneValue(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function safeCall(fn, thisArg, ...args) {
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(thisArg || window, args);
    } catch (error) {
      console.warn('[economics-course-adapter] call failed:', error);
      return undefined;
    }
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function notify(message, type) {
    if (typeof window.toast === 'function') {
      window.toast(message, type || '');
      return;
    }
    console.log('[economics-course-adapter]', message);
  }
})();
