(function initLegacyStudentPageRedirect() {
  const ECONOMICS_NAME = '\u7ecf\u6d4e\u5b66\u57fa\u7840';
  const ECONOMICS_ENTRY_PATH = '/courses/economics-fundamentals/';

  function normalizeCourseName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/课程$/u, '');
  }

  function normalizeRelativePath(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value), location.origin);
      if (url.origin !== location.origin) return '';
      return `${url.pathname}${url.search}${url.hash}` || '';
    } catch {
      return '';
    }
  }

  function canonicalStudentPath(value) {
    const normalized = normalizeRelativePath(value);
    if (!normalized) return '';
    if (/^\/(?:economics|econ)(?:\/)?(?:\?.*)?$/i.test(normalized)) {
      return ECONOMICS_ENTRY_PATH;
    }
    if (/^\/course\/economics(?:\/)?(?:\?.*)?$/i.test(normalized)) {
      return ECONOMICS_ENTRY_PATH;
    }
    if (/^\/courses\/economics-fundamentals(?:\/)?(?:\?.*)?$/i.test(normalized)) {
      return ECONOMICS_ENTRY_PATH;
    }
    return normalized;
  }

  function isUsableStudentPath(path) {
    if (!path) return false;
    if (/^\/(?:student-gallery|student-upload|student-detail)(?:[/?#]|$)/i.test(path)) return false;
    if (/^\/(?:teacher|admin|super-admin)(?:[/?#]|$)/i.test(path)) return false;
    if (/^\/(?:index(?:\.html)?|portal(?:\/)?|student(?:-entry)?(?:\.html)?|student-register(?:\.html)?|course(?:\.html)?)(?:[/?#]|$)/i.test(path)) {
      return false;
    }
    return true;
  }

  function inferNextPath(params) {
    const requested = canonicalStudentPath(params.get('next') || '');
    if (isUsableStudentPath(requested)) return requested;

    const courseName = normalizeCourseName(params.get('course'));
    if (courseName && courseName === normalizeCourseName(ECONOMICS_NAME)) {
      return ECONOMICS_ENTRY_PATH;
    }
    return '';
  }

  function buildStudentEntryRedirectUrl() {
    const currentParams = new URLSearchParams(location.search);
    const targetParams = new URLSearchParams();
    const code = String(currentParams.get('code') || '').trim();
    const nextPath = inferNextPath(currentParams);

    if (code) targetParams.set('code', code);
    if (nextPath) targetParams.set('next', nextPath);

    const query = targetParams.toString();
    const path = `/student-entry${query ? `?${query}` : ''}`;
    return typeof window.classShowStudentUrl === 'function'
      ? window.classShowStudentUrl(path)
      : path;
  }

  function redirectLegacyStudentPage() {
    const href = buildStudentEntryRedirectUrl();
    const link = document.getElementById('studentRedirectLink');
    if (link) link.href = href;
    location.replace(href);
    return href;
  }

  window.buildClassShowStudentEntryRedirect = buildStudentEntryRedirectUrl;
  window.redirectLegacyStudentPage = redirectLegacyStudentPage;
})();
