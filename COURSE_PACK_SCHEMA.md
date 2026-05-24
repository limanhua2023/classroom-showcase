# Course Pack Schema

## Goal

ClassShow should stop treating each course as a standalone static app.
From now on, a new course should mostly mean:

1. add a course pack
2. register the slug
3. reuse the shared player

## Runtime split

- Shared player: [public/course-player.html](/d:/Users/ACER/AIOT-TEST/public/course-player.html)
- Shared engine: [public/js/course-engine.js](/d:/Users/ACER/AIOT-TEST/public/js/course-engine.js)
- Course pack root: `public/course-packs/<slug>/`

## Required files

```text
public/course-packs/<slug>/
  manifest.json
  modules/
    <module-id>.json
```

## `manifest.json`

Required fields:

```json
{
  "schema_version": "classshow-course-pack-v1",
  "pack_version": "2026.05.24",
  "updated_at": "2026-05-24T03:00:00.000Z",
  "course": {
    "slug": "economics-fundamentals",
    "name": "经济学基础课程",
    "course_name": "经济学基础课程",
    "short_name": "经济学基础",
    "audience": "大一新生",
    "description": "..."
  },
  "engine": {
    "player_version": "course-engine-v1",
    "default_module_id": "thinking-tools-01"
  },
  "modules": [
    {
      "id": "thinking-tools-01",
      "title": "思维工具：从机会成本到边际分析",
      "summary": "...",
      "duration_minutes": 18,
      "status": "ready",
      "file": "modules/thinking-tools-01.json"
    }
  ]
}
```

## Module file

Supported block types in `course-engine-v1`:

- `lead`
- `objective_list`
- `concept_grid`
- `bullet_list`
- `scenario`
- `quote`
- `quiz_single`
- `reflection`

Example:

```json
{
  "schema_version": "classshow-course-module-v1",
  "module_id": "thinking-tools-01",
  "title": "思维工具：从机会成本到边际分析",
  "summary": "...",
  "objectives": [
    "..."
  ],
  "blocks": [
    {
      "type": "lead",
      "text": "..."
    }
  ]
}
```

## Migration rule

- Do not build the second course as another 10k-line HTML page.
- Move course content into modules first.
- Keep teacher-only assets out of the public course pack.
- Reuse shared widgets before adding a course-specific adapter.

## Current sample

- Player sample: `/course-player.html?slug=economics-fundamentals`
- Course pack sample: `public/course-packs/economics-fundamentals/`

