import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const EXPECTED_ENTRY_PATH = '/courses/economics-fundamentals/';
const ECONOMICS_NAME = '经济学基础';

function fail(message) {
  throw new Error(message);
}

function normalizeCourseName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/课程$/u, '');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    fail(`${label} missing expected marker: ${needle}`);
  }
}

function assertExcludes(source, needle, label) {
  if (source.includes(needle)) {
    fail(`${label} still contains forbidden marker: ${needle}`);
  }
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

export async function auditEconomicsStudentGate() {
  const [
    indexHtml,
    courseHtml,
    studentRegisterHtml,
    studentEntryHtml,
    adapterJs,
    courseRuntimeJs,
    courseEngineJs,
    economicsHtml,
    redirectsFile
  ] = await Promise.all([
    fs.readFile('public/index.html', 'utf8'),
    fs.readFile('public/course.html', 'utf8'),
    fs.readFile('public/student-register.html', 'utf8'),
    fs.readFile('public/student-entry.html', 'utf8'),
    fs.readFile('public/js/economics-course-adapter.js', 'utf8'),
    fs.readFile('public/js/course-runtime.js', 'utf8'),
    fs.readFile('public/js/course-engine.js', 'utf8'),
    fs.readFile('public/courses/economics-fundamentals/index.html', 'utf8'),
    fs.readFile('public/_redirects', 'utf8')
  ]);

  for (const [label, source] of [
    ['legacy student index shell', indexHtml],
    ['legacy course shell', courseHtml],
    ['legacy student register shell', studentRegisterHtml]
  ]) {
    assertIncludes(source, 'student-entry-redirect.js', label);
    assertExcludes(source, 'teacher-login.html', label);
    assertExcludes(source, 'super-admin.html', label);
    assertExcludes(source, 'student-register.html?next=', label);
    assertExcludes(source, 'course.html?course=', label);
  }

  assertIncludes(studentEntryHtml, 'normalizeRequestedEntryPath', 'student entry');
  assertIncludes(studentEntryHtml, 'normalizeAllowedEntryPath', 'student entry');
  assertIncludes(studentEntryHtml, "return '/courses/economics-fundamentals/';", 'student entry fallback');
  assertExcludes(studentEntryHtml, 'resolveNextTarget', 'student entry');

  assertExcludes(economicsHtml, '进入教师模式', 'economics course page');
  assertExcludes(economicsHtml, 'id="teacher-btn"', 'economics course page');
  assertExcludes(economicsHtml, "params.get('teacher')", 'economics course page');
  assertExcludes(economicsHtml, "document.getElementById('teacher-btn')", 'economics course page');

  assertIncludes(adapterJs, 'classshowEconSaveBtn', 'economics adapter');
  assertIncludes(adapterJs, 'function normalizeEntryPath(path)', 'economics adapter');
  assertIncludes(adapterJs, 'bootstrapTeacherSupplement(false);', 'economics adapter');
  assertExcludes(adapterJs, 'wantsTeacherMode', 'economics adapter');
  assertExcludes(adapterJs, "'#teacher-btn'", 'economics adapter');
  if (countOccurrences(adapterJs, 'function updateBridgeShell(') !== 1) {
    fail('economics adapter must define updateBridgeShell exactly once');
  }

  assertExcludes(courseRuntimeJs, '/course.html?course=', 'course runtime');
  assertExcludes(courseRuntimeJs, "/index.html", 'course runtime');

  assertExcludes(courseEngineJs, '/student-register.html', 'course engine');
  assertExcludes(courseEngineJs, '/course.html?course=', 'course engine');
  assertExcludes(courseEngineJs, "/index.html", 'course engine');

  assertIncludes(redirectsFile, '/portal /student-entry 302', 'student redirects');
  assertIncludes(redirectsFile, `/course/economics ${EXPECTED_ENTRY_PATH} 302`, 'student redirects');

  if (normalizeCourseName(ECONOMICS_NAME) !== normalizeCourseName('经济学基础课程')) {
    fail('course normalization must treat 经济学基础 and 经济学基础课程 as the same course');
  }

  return {
    detail: 'legacy student shells redirect cleanly, economics course chrome is student-only, and supporting scripts no longer depend on old portals'
  };
}

async function main() {
  const result = await auditEconomicsStudentGate();
  console.log('Economics student gate check passed.');
  if (result.detail) console.log(result.detail);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
