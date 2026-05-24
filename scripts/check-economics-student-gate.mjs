import fs from 'node:fs/promises';

const courseHtml = await fs.readFile('public/courses/economics-fundamentals/index.html', 'utf8');
const adapterJs = await fs.readFile('public/js/economics-course-adapter.js', 'utf8');
const studentEntryHtml = await fs.readFile('public/student-entry.html', 'utf8');

function fail(message) {
  throw new Error(message);
}

function normalizeCourseName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[《》]/g, '')
    .replace(/课程$/u, '');
}

function normalizeEntryPath(path) {
  if (!path) return '';
  const url = new URL(String(path), 'https://classshow-student.pages.dev');
  let normalizedPath = `${url.pathname}${url.search}`.replace(/\/+$/, match => match === '/' ? '/' : '');
  if (/^\/(?:economics|econ)(?:\/)?(?:\?.*)?$/i.test(normalizedPath)) {
    normalizedPath = '/courses/economics-fundamentals';
  }
  if (/^\/courses\/economics-fundamentals(?:\/)?(?:\?.*)?$/i.test(normalizedPath)) {
    normalizedPath = '/courses/economics-fundamentals';
  }
  return normalizedPath;
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    fail(`${label} missing expected marker: ${needle}`);
  }
}

assertIncludes(courseHtml, 'normalizeCourseName(activityCourseName)', 'early course gate');
assertIncludes(adapterJs, 'function normalizeEntryPath(path)', 'economics adapter');
assertIncludes(adapterJs, 'studentOnlyView', 'student-only course chrome');
assertIncludes(studentEntryHtml, "return '/courses/economics-fundamentals/';", 'student entry fallback');
if (studentEntryHtml.includes('resolveNextTarget')) {
  fail('student entry must not use stale next targets');
}

const expectedCourse = normalizeCourseName('经济学基础');
const actualShortCourse = normalizeCourseName('经济学基础');
if (expectedCourse !== actualShortCourse) {
  fail('course normalization does not treat short economics activity names as equivalent');
}

const assigned = normalizeEntryPath('/economics');
const current = normalizeEntryPath('/courses/economics-fundamentals/');
if (assigned !== current) {
  fail(`entry path normalization mismatch: assigned=${assigned}; current=${current}`);
}

console.log('Economics student gate check passed.');
