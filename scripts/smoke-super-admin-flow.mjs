import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_BACKEND_BASE = 'https://classroom-showcase.onrender.com';

function fail(message) {
  throw new Error(message);
}

function normalizeBaseUrl(input, fallback = DEFAULT_BACKEND_BASE) {
  const value = String(input || fallback).trim().replace(/\/+$/, '');
  return value || fallback;
}

function rand(prefix = 'sa') {
  return `${prefix}${Date.now().toString(36).slice(-6).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function readEnvPasswordFile(filename) {
  try {
    const fullPath = path.join(process.cwd(), filename);
    const raw = await fs.readFile(fullPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^SUPER_ADMIN_PASSWORD\s*=\s*(.*)$/);
      if (!match) continue;
      return String(match[1] || '').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
  return '';
}

export async function resolveSuperAdminPassword() {
  const direct = String(
    process.env.CLASSSHOW_SUPER_ADMIN_PASSWORD
    || process.env.SUPER_ADMIN_PASSWORD
    || ''
  ).trim();
  if (direct) return direct;

  const local = await readEnvPasswordFile('.env.local');
  if (local) return local;

  return readEnvPasswordFile('.env');
}

async function request(base, pathname, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');
  return { response, body };
}

async function api(base, pathname, options = {}) {
  const { response, body } = await request(base, pathname, options);
  if (!response.ok) {
    const detail = typeof body === 'string'
      ? body
      : body?.error || body?.detail || body?.message || JSON.stringify(body);
    fail(`${options.method || 'GET'} ${pathname} failed: ${response.status} ${detail}`);
  }
  return body;
}

async function getOverview(base, token) {
  return api(base, '/api/super-admin/overview', {
    headers: { 'x-super-admin-auth': token }
  });
}

function findRegistryEntry(overview, slug) {
  return Array.isArray(overview?.registry?.courses)
    ? overview.registry.courses.find(entry => String(entry?.slug || '') === String(slug || ''))
    : null;
}

export async function runSuperAdminSmoke({
  backendBase = DEFAULT_BACKEND_BASE,
  password = '',
  exerciseMutations = true
} = {}) {
  const normalizedBase = normalizeBaseUrl(backendBase);
  const resolvedPassword = String(password || '').trim() || await resolveSuperAdminPassword();

  const status = await api(normalizedBase, '/api/super-admin/status');
  if (!status?.configured) {
    fail('Super-admin backend is not configured. Set SUPER_ADMIN_PASSWORD on the server first.');
  }

  const unauthorized = await request(normalizedBase, '/api/super-admin/overview');
  if (unauthorized.response.status !== 401) {
    fail(`Expected unauthenticated /api/super-admin/overview to return 401, got ${unauthorized.response.status}`);
  }

  if (!resolvedPassword) {
    fail('Missing super-admin password. Set CLASSSHOW_SUPER_ADMIN_PASSWORD or SUPER_ADMIN_PASSWORD, or add SUPER_ADMIN_PASSWORD to .env.local/.env.');
  }

  const login = await api(normalizedBase, '/api/super-admin/login', {
    method: 'POST',
    body: JSON.stringify({ password: resolvedPassword })
  });
  const token = String(login?.token || '').trim();
  if (!token) fail('Super-admin login returned no token.');

  const overview = await getOverview(normalizedBase, token);
  const egress = await api(normalizedBase, '/api/super-admin/egress-profile', {
    headers: { 'x-super-admin-auth': token }
  });

  const originalSlugs = Array.isArray(overview?.registry?.courses)
    ? overview.registry.courses.map(entry => String(entry?.slug || '')).filter(Boolean)
    : [];
  if (!originalSlugs.length) fail('Super-admin overview returned no registry courses.');
  if (!overview?.summary || !overview?.registry || !egress?.snapshot) {
    fail('Super-admin overview or egress payload is incomplete.');
  }

  const tempSlug = `smoke-admin-${Date.now().toString(36).slice(-8)}`;
  const tempCourseName = `超级管理员验收-${tempSlug}`;
  const tempEntryPath = `/courses/${tempSlug}/`;
  let tempEntryCreated = false;

  try {
    if (exerciseMutations) {
      const createResult = await api(normalizedBase, '/api/super-admin/course-registry/save', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({
          course_name: tempCourseName,
          short_name: tempCourseName,
          slug: tempSlug,
          module_key: `${tempSlug}-v1`,
          entry_path: tempEntryPath,
          integration_status: 'planned',
          description: '自动验收：超级管理员课程注册表临时项。',
          is_active: true,
          portal_default: false,
          launch_ready: false,
          scaffold_enabled: false,
          supports_activity_context: true,
          supports_shared_identity: true,
          supports_invite_codes: true
        })
      });
      if (createResult?.mode !== 'created') {
        fail(`Expected course-registry/save to create a temp entry, got mode=${createResult?.mode || '-'}`);
      }
      tempEntryCreated = true;

      const afterCreate = await getOverview(normalizedBase, token);
      const createdEntry = findRegistryEntry(afterCreate, tempSlug);
      if (!createdEntry) fail('Temp registry entry missing after create.');
      if (createdEntry.is_active === false) fail('Temp registry entry unexpectedly inactive right after create.');

      await api(normalizedBase, '/api/super-admin/course-registry/toggle', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({
          course_name: tempCourseName,
          slug: tempSlug,
          is_active: false
        })
      });
      const afterDisable = await getOverview(normalizedBase, token);
      if (findRegistryEntry(afterDisable, tempSlug)?.is_active !== false) {
        fail('Temp registry entry did not become inactive after toggle(false).');
      }

      await api(normalizedBase, '/api/super-admin/course-registry/toggle', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({
          course_name: tempCourseName,
          slug: tempSlug,
          is_active: true
        })
      });
      const afterEnable = await getOverview(normalizedBase, token);
      if (findRegistryEntry(afterEnable, tempSlug)?.is_active === false) {
        fail('Temp registry entry did not become active again after toggle(true).');
      }

      const scaffoldResult = await api(normalizedBase, '/api/super-admin/course-registry/scaffold', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({
          course_name: tempCourseName,
          slug: tempSlug
        })
      });
      if (!scaffoldResult?.course?.scaffold_enabled) {
        fail('Temp registry entry was not marked scaffold_enabled after scaffold call.');
      }
      const afterScaffold = await getOverview(normalizedBase, token);
      const scaffoldEntry = findRegistryEntry(afterScaffold, tempSlug);
      if (!scaffoldEntry?.scaffold_enabled || !scaffoldEntry?.dedicated_page_available) {
        fail('Temp registry entry did not expose scaffolded dedicated page state.');
      }

      const currentSlugs = afterScaffold.registry.courses.map(entry => String(entry?.slug || '')).filter(Boolean);
      const reorderedSlugs = [tempSlug, ...currentSlugs.filter(slug => slug !== tempSlug)];
      await api(normalizedBase, '/api/super-admin/course-registry/reorder', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({ ordered_slugs: reorderedSlugs })
      });
      const afterReorder = await getOverview(normalizedBase, token);
      if (String(afterReorder?.registry?.courses?.[0]?.slug || '') !== tempSlug) {
        fail('Temp registry entry did not move to the top after reorder.');
      }

      const updateResult = await api(normalizedBase, '/api/super-admin/course-registry/save', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({
          original_course_name: tempCourseName,
          original_slug: tempSlug,
          course_name: tempCourseName,
          short_name: `${tempCourseName}-updated`,
          slug: tempSlug,
          module_key: `${tempSlug}-v2`,
          entry_path: tempEntryPath,
          integration_status: 'integrating',
          description: '自动验收：超级管理员课程注册表临时项已更新。',
          is_active: true,
          portal_default: false,
          launch_ready: false,
          scaffold_enabled: true,
          supports_activity_context: true,
          supports_shared_identity: true,
          supports_invite_codes: true
        })
      });
      if (updateResult?.mode !== 'updated') {
        fail(`Expected course-registry/save to update temp entry, got mode=${updateResult?.mode || '-'}`);
      }
      const afterUpdate = await getOverview(normalizedBase, token);
      const updatedEntry = findRegistryEntry(afterUpdate, tempSlug);
      if (!updatedEntry || String(updatedEntry.module_key || '') !== `${tempSlug}-v2`) {
        fail('Temp registry entry was not updated as expected.');
      }

      await api(normalizedBase, '/api/super-admin/course-registry/delete', {
        method: 'POST',
        headers: { 'x-super-admin-auth': token },
        body: JSON.stringify({
          course_name: tempCourseName,
          slug: tempSlug
        })
      });
      tempEntryCreated = false;

      const finalOverview = await getOverview(normalizedBase, token);
      if (findRegistryEntry(finalOverview, tempSlug)) {
        fail('Temp registry entry still exists after delete.');
      }
      const finalSlugs = finalOverview.registry.courses.map(entry => String(entry?.slug || '')).filter(Boolean);
      if (JSON.stringify(finalSlugs) !== JSON.stringify(originalSlugs)) {
        fail('Registry order did not return to its original state after temp entry cleanup.');
      }
    }
  } catch (error) {
    if (tempEntryCreated) {
      try {
        await api(normalizedBase, '/api/super-admin/course-registry/delete', {
          method: 'POST',
          headers: { 'x-super-admin-auth': token },
          body: JSON.stringify({
            course_name: tempCourseName,
            slug: tempSlug
          })
        });
      } catch (cleanupError) {
        throw new Error(`${error.message} | cleanup failed: ${cleanupError.message}`);
      }
    }
    throw error;
  }

  return {
    ok: true,
    backend_base: normalizedBase,
    configured: status.configured,
    registered_course_count: Number(status.registered_course_count || 0),
    ready_course_count: Number(status.ready_course_count || 0),
    registry_backend: status.registry_backend || '',
    egress_snapshot_ready: !!egress?.snapshot,
    exercised_mutations: !!exerciseMutations
  };
}

async function main() {
  const backendBase = normalizeBaseUrl(process.env.CLASSSHOW_BACKEND_BASE || process.argv[2], DEFAULT_BACKEND_BASE);
  const result = await runSuperAdminSmoke({ backendBase });
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
