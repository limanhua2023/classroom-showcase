(function () {
  const SUMMARY_MS = 60000;

  const activityId = typeof getActivityId === 'function' ? getActivityId() : null;
  const user = typeof getSession === 'function' ? getSession() : null;
  const guest = typeof isGuest === 'function' ? isGuest() : false;
  const panel = document.getElementById('learningArena');
  let summaryTimer = null;
  let lastSummary = null;

  if (!activityId || !user || guest) {
    if (panel) renderGuestPanel();
    return;
  }

  function fmtMinutes(minutes) {
    const value = Number(minutes || 0);
    if (value < 1) return '<1 分钟';
    if (value < 60) return `${Math.round(value)} 分钟`;
    const hours = Math.floor(value / 60);
    const rest = Math.round(value % 60);
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }

  function fmtNumber(value) {
    const num = Number(value || 0);
    return num >= 100 ? Math.round(num).toString() : (Math.round(num * 10) / 10).toString();
  }

  function renderGuestPanel() {
    panel.innerHTML = `
      <div class="learning-arena-shell">
        <div class="learning-arena-copy">
          <span class="learning-kicker">LEARNING ARENA</span>
          <h2>登录后解锁学习力排行</h2>
          <p>学生登录后会自动累计有效在线学习时长，并参与个人与小组学习力榜。</p>
        </div>
      </div>
    `;
  }

  async function loadSummary() {
    if (!panel) return;
    try {
      const summary = await api('/student/learning/summary?activity_id=' + encodeURIComponent(activityId) + '&user_id=' + encodeURIComponent(user.id));
      lastSummary = summary;
      renderSummary(summary);
    } catch (error) {
      renderError(error.message);
    }
  }

  function renderSchemaNotice(message) {
    panel.innerHTML = `
      <div class="learning-arena-shell learning-arena-warning">
        <div>
          <span class="learning-kicker">LEARNING ARENA</span>
          <h2>学习时长模块等待数据库升级</h2>
          <p>${escapeHtml(message || '请教师运行最新 upgrade_v4.sql 后，本模块会自动开始记录。')}</p>
        </div>
      </div>
    `;
  }

  function renderError(message) {
    panel.innerHTML = `
      <div class="learning-arena-shell learning-arena-warning">
        <div>
          <span class="learning-kicker">LEARNING ARENA</span>
          <h2>学习力数据暂时不可用</h2>
          <p>${escapeHtml(message || '稍后会自动重试，不影响上传和评分。')}</p>
        </div>
      </div>
    `;
  }

  function topRows(rows, formatter) {
    if (!rows || !rows.length) {
      return '<div class="learning-empty">等待同学们上线后生成排行</div>';
    }
    return rows.slice(0, 8).map(formatter).join('');
  }

  function renderSummary(summary) {
    if (!summary || summary.schema_ready === false) {
      renderSchemaNotice(summary?.error);
      return;
    }
    const mine = summary.my || {};
    const myRank = mine.rank ? `第 ${mine.rank} 名` : '待上榜';
    const myGroup = (summary.group_leaderboard || []).find(item =>
      String(item.class_name || '') === String(mine.class_name || '') &&
      String(item.group_name || '') === String(mine.group_name || '')
    );
    const myGroupRank = myGroup?.rank ? `第 ${myGroup.rank} 名` : '待上榜';
    const updated = summary.generated_at ? formatBangkokTime(summary.generated_at, { withSeconds: false }) : '';

    panel.innerHTML = `
      <div class="learning-arena-shell">
        <div class="learning-arena-head">
          <div>
            <span class="learning-kicker">LEARNING ARENA</span>
            <h2>学习力竞技场</h2>
            <p>系统自动统计有效在线学习时长、上传、评分、评论和浏览互动，形成个人与小组战力榜。</p>
          </div>
          <span class="learning-refresh">更新 ${escapeHtml(updated)}</span>
        </div>

        <div class="learning-metrics">
          <div class="learning-metric hot">
            <span>我的在线学习</span>
            <strong>${escapeHtml(fmtMinutes(mine.active_minutes))}</strong>
            <small>${escapeHtml(myRank)}</small>
          </div>
          <div class="learning-metric">
            <span>学习力分数</span>
            <strong>${escapeHtml(fmtNumber(mine.engagement_score))}</strong>
            <small>作品 ${mine.work_count || 0} / 互动 ${Number(mine.ratings_given || 0) + Number(mine.comments_given || 0) + Number(mine.views_given || 0)}</small>
          </div>
          <div class="learning-metric group">
            <span>我的小组战力</span>
            <strong>${escapeHtml(myGroupRank)}</strong>
            <small>${escapeHtml([mine.class_name, mine.group_name].filter(Boolean).join(' · ') || '未分组')}</small>
          </div>
        </div>

        <div class="learning-boards">
          <div class="learning-board">
            <div class="learning-board-title">个人在线学习榜</div>
            ${topRows(summary.leaderboard, row => `
              <div class="learning-row ${String(row.user_id) === String(user.id) ? 'is-me' : ''}">
                <span class="learning-rank">#${row.rank}</span>
                <span class="learning-name">${escapeHtml(row.name || row.student_id || '同学')}</span>
                <span class="learning-sub">${escapeHtml(row.student_id || '')}</span>
                <strong>${escapeHtml(fmtMinutes(row.active_minutes))}</strong>
              </div>
            `)}
          </div>

          <div class="learning-board group-board">
            <div class="learning-board-title">小组学习力战榜</div>
            ${topRows(summary.group_leaderboard, row => `
              <div class="learning-row ${myGroup && row.group_key === myGroup.group_key ? 'is-me' : ''}">
                <span class="learning-rank">#${row.rank}</span>
                <span class="learning-name">${escapeHtml(row.group_name || '未分组')}</span>
                <span class="learning-sub">${escapeHtml(row.class_name || '')} · ${row.member_count || 0}人</span>
                <strong>${escapeHtml(fmtNumber(row.engagement_score))}</strong>
              </div>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  function start() {
    loadSummary();
    if (panel) summaryTimer = setInterval(loadSummary, SUMMARY_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (panel && lastSummary) {
        loadSummary();
      } else if (panel) {
        loadSummary();
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (summaryTimer) clearInterval(summaryTimer);
  });

  start();
})();
