# Course Page Integration Spec

## Goal
- Attach future course-specific frontends under the shared ClassShow portal without rebuilding identity, invite-code isolation, upload, scoring, feedback, learning-time, archive, and maintenance systems.

## File and Route Convention
- Course pages live at `public/courses/<slug>/index.html`.
- Course registration lives in `data/course-registry.json`.
- Registry fields currently used:
  - `slug`
  - `course_name`
  - `short_name`
  - `audience`
  - `visual_style`
  - `description`
  - `integration_status`
  - `entry_path`
  - `module_key`
  - `portal_default`
  - `launch_ready`
  - `supports_activity_context`
  - `supports_shared_identity`
  - `supports_invite_codes`

## Shared Runtime Contract
- Every dedicated course page should include:
  - `/js/api.js`
  - `/js/course-runtime.js`
- Runtime object:
  - `ClassShowCourseRuntime.getContext()`
  - `ClassShowCourseRuntime.fetchRegistry(courseName)`
  - `ClassShowCourseRuntime.fetchCourse(courseName)`
  - `ClassShowCourseRuntime.openPortal(courseName)`
  - `ClassShowCourseRuntime.openIndex()`

## Current Public APIs for Course Pages
- `GET /api/portal/courses`
- `GET /api/portal/course-activities?course_name=...`
- `GET /api/portal/course-registry?course_name=...`

## Security Boundary
- Portal APIs must not expose activity `invite_code`.
- Students keep one shared identity across courses.
- Different courses and different activities keep separate invite codes.
- Course pages may decorate the experience, but they must not bypass the shared identity and classroom-entry flow.

## Integration Checklist for a New Course Page
1. Put the page in `public/courses/<slug>/index.html`.
2. Add or update the matching entry in `data/course-registry.json`.
3. Include `/js/api.js` and `/js/course-runtime.js`.
4. Read context from `ClassShowCourseRuntime.getContext()`.
5. Read course metadata from `ClassShowCourseRuntime.fetchRegistry(courseName)`.
6. Read live course activities from `ClassShowCourseRuntime.fetchCourse(courseName)`.
7. Keep uploads, comments, ratings, feedback, learning-time, and maintenance flows on shared APIs.
8. Verify the route appears in:
   - `/super-admin.html`
   - `/course.html?course=<course_name>`
   - `/index.html`

## First Dedicated Course Slot
- Course: `经济学基础课程`
- Slug: `economics-fundamentals`
- Route: `/courses/economics-fundamentals/`
- Module key: `economics-fundamentals-v1`

## Second Planned Slot
- Course: `AI学习课程`
- Slug: `ai-learning`
- Route: `/courses/ai-learning/`
- Module key: `ai-learning-v1`
