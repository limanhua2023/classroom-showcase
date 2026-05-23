window.CLASSSHOW_CONFIG = window.CLASSSHOW_CONFIG || {};

// Host-specific overrides for split deployments.
// Example:
// window.CLASSSHOW_HOST_OVERRIDES = {
//   'classroom-showcase.onrender.com': {
//     backendBase: 'https://classroom-showcase.onrender.com',
//     studentBase: 'https://your-student-site.pages.dev',
//     apiBase: 'https://classroom-showcase.onrender.com/api'
//   },
//   'your-student-site.pages.dev': {
//     backendBase: 'https://classroom-showcase.onrender.com',
//     studentBase: 'https://your-student-site.pages.dev',
//     apiBase: 'https://classroom-showcase.onrender.com/api'
//   }
// };
window.CLASSSHOW_HOST_OVERRIDES = window.CLASSSHOW_HOST_OVERRIDES || {
  'classroom-showcase.onrender.com': {
    backendBase: 'https://classroom-showcase.onrender.com',
    studentBase: 'https://classshow-student.pages.dev',
    apiBase: 'https://classroom-showcase.onrender.com/api'
  },
  'classshow-student.pages.dev': {
    backendBase: 'https://classroom-showcase.onrender.com',
    studentBase: 'https://classshow-student.pages.dev',
    apiBase: 'https://classroom-showcase.onrender.com/api'
  }
};
