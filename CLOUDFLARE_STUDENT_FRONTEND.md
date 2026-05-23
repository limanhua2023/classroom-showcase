# Cloudflare Student Frontend

## Goal

Move the student-facing static frontend to Cloudflare Pages while keeping:

- teacher/admin pages on Render
- `/api/*` on Render
- data/media in Supabase

This is the recommended split for the current ClassShow architecture.

## What should move first

Publish the full student journey to one static origin:

- `/index.html`
- `/course.html`
- `/student-register.html`
- `/student-gallery.html`
- `/student-upload.html`
- `/student-detail.html`
- `/display.html`
- `/courses/economics-fundamentals/`

Do not move only `/economics` or only one course page. The student flow uses `sessionStorage`, so the whole student journey must stay on one origin.

## What should stay on Render

- `/teacher-login.html`
- `/teacher-dashboard.html`
- `/teacher-feedback.html`
- `/super-admin.html`
- `/api/*`

These pages still depend on the Node/Express backend and shared admin APIs.

## Runtime config

Split deployment is controlled by:

- [public/js/deployment-config.js](/d:/Users/ACER/AIOT-TEST/public/js/deployment-config.js)
- [public/js/app-config.js](/d:/Users/ACER/AIOT-TEST/public/js/app-config.js)

Add your real host mapping in `public/js/deployment-config.js`.
Student pages are marked with `window.CLASSSHOW_SURFACE = 'student'`, so once host mapping is filled in, an accidentally opened Render student page will auto-redirect back to the Cloudflare student site.

Example:

```js
window.CLASSSHOW_HOST_OVERRIDES = {
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
```

Current student site:

- `https://classshow-student.pages.dev`

## Rollout order

1. Create a Cloudflare Pages project for the student frontend.
2. Publish the `public/` student pages and assets to that Pages site.
3. Fill in the host mapping in `public/js/deployment-config.js`.
4. Verify student login, invite-code join, course portal, economics course, gallery, upload, detail, display, and learning heartbeat.
5. After verification, point teacher/admin deep links to the Cloudflare student origin only.

## Do all future pages need Cloudflare

No.

Recommended long-term split:

- all student-facing static pages and course pages: Cloudflare Pages
- teacher/admin/API/backend logic: Render or another Node host

Only move teacher/admin/API off Render later if you decide to replace the current backend architecture.
