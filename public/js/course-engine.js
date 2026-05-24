(function initCourseEngine() {
  const params = new URLSearchParams(location.search);
  const state = {
    slug: '',
    manifest: null,
    currentModuleMeta: null,
    currentModuleData: null
  };
  const els = {};

  document.addEventListener('DOMContentLoaded', bootstrap);

  async function bootstrap() {
    cacheElements();
    bindStaticActions();

    state.slug = (params.get('slug') || '').trim();
    if (!state.slug) {
      renderFatal('缺少课程 slug，无法加载课程包。');
      return;
    }

    try {
      state.manifest = await fetchJson(studentUrl(`/course-packs/${encodeURIComponent(state.slug)}/manifest.json`));
      hydrateManifestShell();
      const defaultModuleId = params.get('module')
        || state.manifest.engine?.default_module_id
        || state.manifest.modules?.[0]?.id;
      if (!defaultModuleId) {
        renderFatal('课程包里还没有可用模块。');
        return;
      }
      await openModule(defaultModuleId, { replaceHistory: true });
    } catch (error) {
      renderFatal(error.message || '课程包加载失败');
    }
  }

  function cacheElements() {
    els.courseTitle = document.getElementById('playerCourseTitle');
    els.courseDescription = document.getElementById('playerCourseDescription');
    els.contextChips = document.getElementById('playerContextChips');
    els.sidebarMeta = document.getElementById('playerSidebarMeta');
    els.moduleCount = document.getElementById('playerModuleCount');
    els.moduleList = document.getElementById('playerModuleList');
    els.moduleTitle = document.getElementById('playerModuleTitle');
    els.moduleSummary = document.getElementById('playerModuleSummary');
    els.moduleMeta = document.getElementById('playerModuleMeta');
    els.moduleStatus = document.getElementById('playerModuleStatus');
    els.moduleBody = document.getElementById('playerModuleBody');
    els.portalButton = document.getElementById('playerPortalButton');
    els.legacyButton = document.getElementById('playerLegacyButton');
    els.indexButton = document.getElementById('playerIndexButton');
    els.prevButton = document.getElementById('playerPrevButton');
    els.nextButton = document.getElementById('playerNextButton');
  }

  function bindStaticActions() {
    els.portalButton.addEventListener('click', () => {
      const courseName = state.manifest?.course?.course_name || state.manifest?.course?.name || '';
      if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.openPortal === 'function') {
        window.ClassShowCourseRuntime.openPortal(courseName);
        return;
      }
      location.href = studentUrl(`/course.html?course=${encodeURIComponent(courseName)}`);
    });
    els.legacyButton.addEventListener('click', () => {
      const path = state.manifest?.course?.legacy_entry_path || `/courses/${state.slug}/`;
      location.href = studentUrl(path);
    });
    els.indexButton.addEventListener('click', () => {
      if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.openIndex === 'function') {
        window.ClassShowCourseRuntime.openIndex();
        return;
      }
      location.href = studentUrl('/index.html');
    });
    els.prevButton.addEventListener('click', () => moveModule(-1));
    els.nextButton.addEventListener('click', () => moveModule(1));
    els.moduleList.addEventListener('click', event => {
      const button = event.target.closest('[data-module-id]');
      if (!button) return;
      openModule(button.getAttribute('data-module-id'));
    });
    els.moduleBody.addEventListener('click', event => {
      const button = event.target.closest('[data-quiz-check]');
      if (!button) return;
      handleQuizCheck(button);
    });
  }

  function hydrateManifestShell() {
    const course = state.manifest.course || {};
    const context = readRuntimeContext();
    document.title = `${course.name || course.course_name || state.slug} - 课程模块播放器`;
    els.courseTitle.textContent = course.name || course.course_name || state.slug;
    els.courseDescription.textContent = course.description || '课程内容已经拆成模块包，后续新课程会沿用同一套播放器。';
    els.moduleCount.textContent = String((state.manifest.modules || []).length);

    const chips = [];
    chips.push(renderChip(course.format_label || 'Course pack', 'neutral'));
    if (course.audience) chips.push(renderChip(course.audience, 'neutral'));
    if (context.activity_id) chips.push(renderChip('活动上下文已连接', 'success'));
    else chips.push(renderChip('设备自学模式', 'warning'));
    if (context.is_guest) chips.push(renderChip('访客', 'neutral'));
    else if (context.user?.name) chips.push(renderChip(context.user.name, 'success'));
    els.contextChips.innerHTML = chips.join('');

    els.sidebarMeta.innerHTML = [
      renderMetaRow('课程 slug', state.slug),
      renderMetaRow('内容包版本', state.manifest.pack_version || '-'),
      renderMetaRow('默认模块', state.manifest.engine?.default_module_id || '-'),
      renderMetaRow('最后更新', formatDateTimeSafe(state.manifest.updated_at))
    ].join('');

    renderModuleList();
  }

  async function openModule(moduleId, options = {}) {
    const moduleMeta = (state.manifest.modules || []).find(item => item.id === moduleId);
    if (!moduleMeta) {
      renderFatal(`找不到模块 ${moduleId}`);
      return;
    }
    els.moduleStatus.textContent = `正在加载模块：${moduleMeta.title}`;
    try {
      const moduleData = await fetchJson(studentUrl(`/course-packs/${encodeURIComponent(state.slug)}/${moduleMeta.file}`));
      state.currentModuleMeta = moduleMeta;
      state.currentModuleData = moduleData;
      renderModuleList();
      renderModule();
      syncHistory(options.replaceHistory === true);
    } catch (error) {
      els.moduleStatus.textContent = `模块加载失败：${error.message || 'unknown error'}`;
      els.moduleBody.innerHTML = `<div class="player-empty-state">${escapeHtmlSafe(error.message || '模块读取失败')}</div>`;
    }
  }

  function moveModule(delta) {
    const modules = state.manifest?.modules || [];
    const currentIndex = modules.findIndex(item => item.id === state.currentModuleMeta?.id);
    if (currentIndex === -1) return;
    const next = modules[currentIndex + delta];
    if (!next) return;
    openModule(next.id);
  }

  function renderModuleList() {
    const modules = state.manifest?.modules || [];
    if (!modules.length) {
      els.moduleList.innerHTML = '<div class="player-empty-state">课程包还没有模块。</div>';
      return;
    }
    els.moduleList.innerHTML = modules.map((moduleMeta, index) => `
      <button
        type="button"
        class="player-module-button${moduleMeta.id === state.currentModuleMeta?.id ? ' is-active' : ''}"
        data-module-id="${escapeHtmlSafe(moduleMeta.id)}">
        <small>模块 ${index + 1} · ${escapeHtmlSafe(moduleMeta.kicker || moduleMeta.status || 'ready')}</small>
        <strong>${escapeHtmlSafe(moduleMeta.title)}</strong>
        <span>${escapeHtmlSafe(moduleMeta.summary || '这个模块还没有摘要。')}</span>
        <small>${escapeHtmlSafe(moduleMeta.duration_minutes ? `${moduleMeta.duration_minutes} 分钟` : '时长待补充')}</small>
      </button>
    `).join('');
  }

  function renderModule() {
    const course = state.manifest.course || {};
    const moduleMeta = state.currentModuleMeta || {};
    const moduleData = state.currentModuleData || {};
    els.moduleTitle.textContent = moduleData.title || moduleMeta.title || '未命名模块';
    els.moduleSummary.textContent = moduleData.summary || moduleMeta.summary || '这个模块还没有摘要。';
    els.moduleMeta.innerHTML = [
      renderChip(moduleMeta.duration_minutes ? `${moduleMeta.duration_minutes} 分钟` : '时长待补充', 'neutral'),
      renderChip(moduleMeta.status || 'ready', moduleMeta.status === 'ready' ? 'success' : 'warning'),
      renderChip(course.short_name || course.name || state.slug, 'neutral')
    ].join('');
    els.moduleStatus.textContent = `已加载 ${moduleMeta.title || moduleData.title}，当前播放器版本 ${state.manifest.engine?.player_version || 'v1'}`;

    const blocks = [];
    if (Array.isArray(moduleData.objectives) && moduleData.objectives.length) {
      blocks.push(renderBlock({
        type: 'objective_list',
        title: '本模块目标',
        items: moduleData.objectives
      }));
    }
    blocks.push(...(Array.isArray(moduleData.blocks) ? moduleData.blocks.map(renderBlock) : []));
    els.moduleBody.innerHTML = blocks.join('') || '<div class="player-empty-state">这个模块还没有内容块。</div>';

    const modules = state.manifest.modules || [];
    const currentIndex = modules.findIndex(item => item.id === moduleMeta.id);
    els.prevButton.disabled = currentIndex <= 0;
    els.nextButton.disabled = currentIndex === -1 || currentIndex >= modules.length - 1;
  }

  function renderBlock(block = {}) {
    switch (block.type) {
      case 'lead':
        return `<section class="player-panel"><p>${escapeHtmlSafe(block.text || '')}</p></section>`;
      case 'objective_list':
        return `
          <section class="player-panel">
            <h3>${escapeHtmlSafe(block.title || '学习目标')}</h3>
            <ul class="player-objective-list">
              ${(block.items || []).map(item => `<li>${escapeHtmlSafe(item)}</li>`).join('')}
            </ul>
          </section>
        `;
      case 'concept_grid':
        return `
          <section class="player-panel">
            <h3>${escapeHtmlSafe(block.title || '关键概念')}</h3>
            <div class="player-concept-grid">
              ${(block.items || []).map(item => `
                <article class="player-concept-card">
                  <strong>${escapeHtmlSafe(item.term || item.title || '概念')}</strong>
                  <p>${escapeHtmlSafe(item.text || item.description || '')}</p>
                </article>
              `).join('')}
            </div>
          </section>
        `;
      case 'bullet_list':
        return `
          <section class="player-panel">
            <h3>${escapeHtmlSafe(block.title || '要点')}</h3>
            <ul class="player-bullet-list">
              ${(block.items || []).map(item => `<li>${escapeHtmlSafe(item)}</li>`).join('')}
            </ul>
          </section>
        `;
      case 'scenario':
        return `
          <section class="player-panel">
            <h3>${escapeHtmlSafe(block.title || '情境案例')}</h3>
            <p>${escapeHtmlSafe(block.prompt || '')}</p>
            ${(block.analysis || []).length ? `
              <ul class="player-analysis-list">
                ${block.analysis.map(item => `<li>${escapeHtmlSafe(item)}</li>`).join('')}
              </ul>
            ` : ''}
          </section>
        `;
      case 'quote':
        return `
          <section class="player-panel player-quote">
            <h3>${escapeHtmlSafe(block.title || '课堂提醒')}</h3>
            <p>${escapeHtmlSafe(block.text || '')}</p>
          </section>
        `;
      case 'quiz_single':
        return `
          <section class="player-panel player-quiz" data-answer-index="${Number(block.answer_index || 0)}">
            <h3>${escapeHtmlSafe(block.title || '随堂检核')}</h3>
            <p>${escapeHtmlSafe(block.question || '')}</p>
            <div class="player-quiz-options">
              ${(block.options || []).map((option, index) => `
                <label class="player-quiz-option">
                  <input type="radio" name="quiz-${escapeHtmlSafe(block.id || block.question || 'default')}" value="${index}">
                  <span>${escapeHtmlSafe(option)}</span>
                </label>
              `).join('')}
            </div>
            <div class="player-quiz-actions">
              <button type="button" class="btn btn-primary btn-sm" data-quiz-check="1">检查答案</button>
              <div class="player-quiz-result" data-quiz-result="1"></div>
            </div>
            <template data-quiz-explanation>${escapeHtmlSafe(block.explanation || '')}</template>
          </section>
        `;
      case 'reflection':
        return `
          <section class="player-panel">
            <h3>${escapeHtmlSafe(block.title || '反思任务')}</h3>
            <p>${escapeHtmlSafe(block.prompt || '')}</p>
          </section>
        `;
      default:
        return `
          <section class="player-panel">
            <h3>${escapeHtmlSafe(block.title || '内容块')}</h3>
            <p>${escapeHtmlSafe(block.text || '暂不支持的内容块类型。')}</p>
          </section>
        `;
    }
  }

  function handleQuizCheck(button) {
    const panel = button.closest('.player-quiz');
    if (!panel) return;
    const checked = panel.querySelector('input[type="radio"]:checked');
    const resultEl = panel.querySelector('[data-quiz-result]');
    const explanationEl = panel.querySelector('template[data-quiz-explanation]');
    if (!resultEl) return;
    if (!checked) {
      resultEl.className = 'player-quiz-result warning';
      resultEl.textContent = '先选一个答案，再检查。';
      return;
    }
    const selected = Number(checked.value);
    const answerIndex = Number(panel.getAttribute('data-answer-index'));
    const explanation = explanationEl ? explanationEl.innerHTML : '';
    if (selected === answerIndex) {
      resultEl.className = 'player-quiz-result success';
      resultEl.innerHTML = `回答正确。${explanation ? ` ${explanation}` : ''}`;
      return;
    }
    resultEl.className = 'player-quiz-result warning';
    resultEl.innerHTML = `答案不对。正确选项是第 ${answerIndex + 1} 项。${explanation ? ` ${explanation}` : ''}`;
  }

  function syncHistory(replaceHistory) {
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('slug', state.slug);
    if (state.currentModuleMeta?.id) nextUrl.searchParams.set('module', state.currentModuleMeta.id);
    if (replaceHistory) history.replaceState({}, '', nextUrl);
    else history.pushState({}, '', nextUrl);
  }

  function renderFatal(message) {
    if (els.moduleBody) {
      els.moduleBody.innerHTML = `<div class="player-empty-state">${escapeHtmlSafe(message)}</div>`;
    }
    if (els.moduleStatus) els.moduleStatus.textContent = message;
    if (els.moduleList) els.moduleList.innerHTML = '<div class="player-empty-state">没有可显示的模块。</div>';
  }

  function renderMetaRow(label, value) {
    return `
      <div class="player-meta-row">
        <strong>${escapeHtmlSafe(label)}</strong>
        <span>${escapeHtmlSafe(value || '-')}</span>
      </div>
    `;
  }

  function renderChip(label, tone = 'neutral') {
    return `<span class="player-chip ${escapeHtmlSafe(tone)}">${escapeHtmlSafe(label)}</span>`;
  }

  function readRuntimeContext() {
    if (window.ClassShowCourseRuntime && typeof window.ClassShowCourseRuntime.getContext === 'function') {
      return window.ClassShowCourseRuntime.getContext();
    }
    return {
      activity_id: '',
      activity: null,
      user: null,
      is_guest: false
    };
  }

  function studentUrl(path = '') {
    return typeof window.classShowStudentUrl === 'function'
      ? window.classShowStudentUrl(path)
      : path;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`读取失败：${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  function formatDateTimeSafe(value) {
    if (!value) return '-';
    if (typeof window.formatDateTime === 'function') {
      return window.formatDateTime(value, { withSeconds: false }) || String(value);
    }
    return String(value);
  }

  function escapeHtmlSafe(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
