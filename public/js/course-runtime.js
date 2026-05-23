(function initCourseRuntime() {
  function studentUrl(path = '') {
    return typeof window.classShowStudentUrl === 'function'
      ? window.classShowStudentUrl(path)
      : path;
  }

  function getCourseParam() {
    return (new URLSearchParams(location.search).get('course') || '').trim();
  }

  function readActivity() {
    try {
      const raw = sessionStorage.getItem('classshow_activity');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getContext() {
    const activity = readActivity();
    const user = typeof getSessionOrGuest === 'function' ? getSessionOrGuest() : null;
    return {
      course_name: getCourseParam() || activity?.course_name || '',
      activity_id: typeof getActivityId === 'function' ? getActivityId() : '',
      activity,
      user,
      is_guest: typeof isGuest === 'function' ? isGuest() : false,
      dedicated_page_path: location.pathname
    };
  }

  async function fetchRegistry(courseName = '') {
    return api('/portal/course-registry?course_name=' + encodeURIComponent(courseName || getCourseParam()));
  }

  async function fetchCourse(courseName = '') {
    return api('/portal/course-activities?course_name=' + encodeURIComponent(courseName || getCourseParam()));
  }

  function openPortal(courseName = '') {
    const target = courseName || getCourseParam() || '';
    location.href = studentUrl('/course.html?course=' + encodeURIComponent(target));
  }

  function openIndex() {
    location.href = studentUrl('/index.html');
  }

  window.ClassShowCourseRuntime = {
    version: '1.0.0',
    getContext,
    fetchRegistry,
    fetchCourse,
    openPortal,
    openIndex
  };

  document.dispatchEvent(new CustomEvent('classshow:course-context-ready', {
    detail: getContext()
  }));
})();
