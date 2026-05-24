(function initClassShowAppConfig() {
  function asObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function resolveBaseUrl(value, fallback) {
    const candidate = firstString(value);
    const base = stripTrailingSlash(fallback || window.location.origin || '');
    if (!candidate) return base;
    try {
      return stripTrailingSlash(new URL(candidate, base || window.location.origin).toString());
    } catch {
      return stripTrailingSlash(candidate);
    }
  }

  function buildUrl(base, path = '') {
    const safeBase = stripTrailingSlash(base || '');
    const safePath = String(path || '').trim();
    if (!safePath) return safeBase;
    if (/^https?:\/\//i.test(safePath)) return safePath;
    if (safePath.startsWith('//')) return `${window.location.protocol}${safePath}`;
    if (safePath.startsWith('?') || safePath.startsWith('#')) return `${safeBase}${safePath}`;
    if (!safeBase) return safePath;
    return safePath.startsWith('/') ? `${safeBase}${safePath}` : `${safeBase}/${safePath}`;
  }

  const globalConfig = asObject(window.CLASSSHOW_CONFIG);
  const hostOverrides = asObject(window.CLASSSHOW_HOST_OVERRIDES);
  const hostConfig = asObject(hostOverrides[window.location.host] || hostOverrides['*']);
  const currentOrigin = stripTrailingSlash(window.location.origin || '');

  const backendBase = resolveBaseUrl(
    firstString(hostConfig.backendBase, hostConfig.backendOrigin, globalConfig.backendBase, globalConfig.backendOrigin),
    currentOrigin
  );
  const studentBase = resolveBaseUrl(
    firstString(hostConfig.studentBase, hostConfig.studentOrigin, globalConfig.studentBase, globalConfig.studentOrigin),
    currentOrigin
  );
  const apiBase = resolveBaseUrl(
    firstString(hostConfig.apiBase, globalConfig.apiBase),
    `${backendBase || currentOrigin}/api`
  );

  const config = {
    host: window.location.host,
    surface: window.CLASSSHOW_SURFACE || '',
    backendBase,
    studentBase,
    apiBase,
    backendUrl(path = '') {
      return buildUrl(backendBase, path);
    },
    studentUrl(path = '') {
      return buildUrl(studentBase, path);
    },
    apiUrl(path = '') {
      return buildUrl(apiBase, path);
    }
  };

  window.ClassShowAppConfig = config;
  window.classShowBackendUrl = path => config.backendUrl(path);
  window.classShowStudentUrl = path => config.studentUrl(path);
  window.classShowApiUrl = path => config.apiUrl(path);
  window.navigateToBackend = path => { window.location.href = config.backendUrl(path); };
  window.navigateToStudent = path => { window.location.href = config.studentUrl(path); };

  function maybeRedirectToPreferredSurface() {
    if (!currentOrigin) return;
    let targetBase = '';
    if (config.surface === 'student') targetBase = studentBase;
    if (config.surface === 'backend') targetBase = backendBase;
    if (!targetBase) return;
    const targetUrl = buildUrl(targetBase, window.location.pathname) + window.location.search + window.location.hash;
    const currentUrl = window.location.origin + window.location.pathname + window.location.search + window.location.hash;
    if (targetUrl !== currentUrl) {
      window.location.replace(targetUrl);
    }
  }

  function rewriteBackendLinks() {
    const backendRoutes = [
      { fragment: 'teacher-login.html?create=1', target: '/teacher-login.html?create=1' },
      { fragment: 'teacher-login.html', target: '/teacher-login.html' },
      { fragment: 'super-admin.html', target: '/super-admin.html' }
    ];

    document.querySelectorAll('[onclick]').forEach(el => {
      const raw = String(el.getAttribute('onclick') || '');
      const match = backendRoutes.find(item => raw.includes(item.fragment));
      if (match) {
        el.onclick = () => {
          window.location.href = config.backendUrl(match.target);
          return false;
        };
      }
    });

    document.querySelectorAll('a[href]').forEach(el => {
      const href = String(el.getAttribute('href') || '').trim();
      const match = backendRoutes.find(item => href === item.fragment);
      if (match) {
        el.setAttribute('href', config.backendUrl(match.target));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rewriteBackendLinks, { once: true });
  } else {
    rewriteBackendLinks();
  }

  maybeRedirectToPreferredSurface();
})();
