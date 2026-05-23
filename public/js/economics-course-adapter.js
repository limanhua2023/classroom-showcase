(function initEconomicsCourseAdapter() {
  const COURSE_NAME = '经济学基础课程';
  const COURSE_SLUG = 'economics-fundamentals';
  const LEARNING_HEARTBEAT_MS = 30000;
  const PROGRESS_SYNC_DEBOUNCE_MS = 1500;
  const LEARNING_SESSION_KEY = 'classshow_learning_session_token';
  const AI_MODE_KEY = 'econCourse_v117_ai_mode';
  const AI_KEY_KEY = 'econCourse_v117_api_key';
  const ECON_SESSION_KEY_PREFIX = 'econCourse_v117_';
  const LOCAL_STUDY_STATS_KEY = 'econCourse_v117_self_study_stats';
  const LOCAL_STUDY_MAX_DELTA_SECONDS = 90;
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
  const runtime = {
    context: readContext(),
    heartbeatTimer: null,
    syncTimer: null,
    syncBusy: false,
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
    localStudySessionToken: makeSessionToken(),
    localStudy: readLocalStudyStats()
  };

  forceLocalAiMode();
  injectBridgeStyles();
  injectBridgeShell();
  hideTeacherEntrypoints();
  patchCourseBridge();
  patchAiControls();
  patchAppRuntime();
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
      location.href = `/course.html?course=${encodeURIComponent(COURSE_NAME)}`;
    });
    document.getElementById('classshowEconIndexBtn').addEventListener('click', () => {
      if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.openIndex === 'function') {
        window.ClassShowCourseRuntime.openIndex();
        return;
      }
      location.href = '/index.html';
    });
    document.getElementById('classshowEconThemeBtn').addEventListener('click', () => {
      if (typeof window.toggleTheme === 'function') {
        window.toggleTheme();
      }
    });
    document.getElementById('classshowEconTeacherBtn').addEventListener('click', () => {
      location.href = '/teacher-dashboard.html';
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
    const teacherBtn = document.getElementById('classshowEconTeacherBtn');
    if (!identityEl || !chipsEl || !syncEl || !teacherBtn) return;

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
    chips.push(renderChip(`本机累计 ${formatStudyDuration(localStudyTotalSeconds())}`, 'ok'));
    if (hasLoggedInStudent()) {
      chips.push(renderChip('学习时长回传中', 'ok'));
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
      },
      onReflectionSubmit(data) {
        safeCall(original.onReflectionSubmit, window, data);
        scheduleProgressSync(data && data.event ? data.event : 'reflection_submit');
      },
      onExperimentComplete(data) {
        safeCall(original.onExperimentComplete, window, data);
        scheduleProgressSync(data && data.event ? data.event : 'experiment_complete');
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
      hydrateRemoteProgress().finally(() => {
        scheduleProgressSync('page_boot');
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

  function startLearningHeartbeat() {
    recordLocalStudy('page_open', { startSession: true });

    const send = active => {
      api('/student/learning/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          activity_id: runtime.context.activity_id,
          user_id: runtime.context.user.id,
          session_token: getLearningSessionToken(),
          page_path: location.pathname,
          active
        })
      }).catch(() => {});
    };

    if (hasLoggedInStudent()) {
      send(!document.hidden);
    } else {
      runtime.syncLabel = '本地自学记录中';
      runtime.syncLevel = document.hidden ? 'warn' : 'ok';
      updateBridgeShell();
    }

    runtime.heartbeatTimer = window.setInterval(() => {
      recordLocalStudy('heartbeat');
      if (hasLoggedInStudent()) {
        send(!document.hidden);
      }
    }, LEARNING_HEARTBEAT_MS);

    document.addEventListener('visibilitychange', () => {
      recordLocalStudy(document.hidden ? 'page_hidden' : 'page_visible');
      if (hasLoggedInStudent()) {
        send(!document.hidden);
      }
      scheduleProgressSync(document.hidden ? 'page_hidden' : 'page_visible');
    });

    window.addEventListener('beforeunload', () => {
      if (runtime.heartbeatTimer) window.clearInterval(runtime.heartbeatTimer);
      recordLocalStudy('page_unload', { active: false });
    });
  }

  function scheduleProgressSync(reason) {
    if (!hasLoggedInStudent() || !window.EconCourseApp || runtime.hydrating) return;
    runtime.syncReason = reason || 'state_change';
    if (runtime.syncTimer) window.clearTimeout(runtime.syncTimer);
    runtime.syncTimer = window.setTimeout(() => {
      runtime.syncTimer = null;
      syncProgress(runtime.syncReason);
    }, PROGRESS_SYNC_DEBOUNCE_MS);
  }

  async function syncProgress(reason) {
    if (!hasLoggedInStudent() || !window.EconCourseApp || runtime.syncBusy) return;
    runtime.syncBusy = true;
    runtime.syncLabel = `同步中 · ${reason}`;
    runtime.syncLevel = 'warn';
    updateBridgeShell();

    try {
      const payload = buildProgressPayload(reason);
      const result = await api('/student/course-runtime/progress', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (result && result.schema_ready === false) {
        runtime.syncLabel = '数据库未启用课程进度表';
        runtime.syncLevel = 'warn';
      } else {
        const app = window.EconCourseApp;
        app.state.classshowMeta = {
          ...(app.state.classshowMeta || {}),
          course_slug: COURSE_SLUG,
          last_remote_sync_at: result && result.progress && result.progress.updated_at
            ? result.progress.updated_at
            : new Date().toISOString()
        };
        runtime.syncLabel = '进度已记录到 ClassShow';
        runtime.syncLevel = 'ok';
      }
    } catch (error) {
      runtime.syncLabel = error && error.message ? error.message : '进度同步失败';
      runtime.syncLevel = 'err';
    } finally {
      runtime.syncBusy = false;
      updateBridgeShell();
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
    let token = sessionStorage.getItem(LEARNING_SESSION_KEY);
    if (!token) {
      token = makeSessionToken();
      sessionStorage.setItem(LEARNING_SESSION_KEY, token);
    }
    return token;
  }

  function makeSessionToken() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `learn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function readLocalStudyStats() {
    try {
      const raw = localStorage.getItem(LOCAL_STUDY_STATS_KEY);
      return normalizeLocalStudyStats(raw ? JSON.parse(raw) : null);
    } catch {
      return normalizeLocalStudyStats(null);
    }
  }

  function normalizeLocalStudyStats(value) {
    const stats = value && typeof value === 'object' ? value : {};
    return {
      session_token: typeof stats.session_token === 'string' ? stats.session_token : '',
      total_seconds: Math.max(0, Number(stats.total_seconds || 0)),
      session_count: Math.max(0, Number(stats.session_count || 0)),
      active: stats.active === true,
      started_at: typeof stats.started_at === 'string' ? stats.started_at : '',
      last_seen_at: typeof stats.last_seen_at === 'string' ? stats.last_seen_at : '',
      updated_at: typeof stats.updated_at === 'string' ? stats.updated_at : '',
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
    const stats = normalizeLocalStudyStats(runtime.localStudy || readLocalStudyStats());
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

    try {
      localStorage.setItem(LOCAL_STUDY_STATS_KEY, JSON.stringify(stats));
    } catch {}

    if (!hasLoggedInStudent()) {
      runtime.syncLabel = active ? '本地自学记录中' : '本地自学已暂停';
      runtime.syncLevel = active ? 'ok' : 'warn';
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
