# CLAUDE.md — Web Starter Template

## Project purpose

Starter template for freelance web projects. Duplicated at the start of every new web project so the hard setup is already done. Must stay consistent across projects so issues are easy to diagnose. Built with Eleventy + Nunjucks + a custom admin CMS (replacing Decap CMS).

## Commands

```bash
npm start       # Eleventy dev server → http://localhost:8080 (layout/template work only)
npm run build   # Production build → _site/
npm run dev     # netlify dev → http://localhost:8888 (required for CMS admin editing locally)
```

## Architecture

### Content pipeline

```
src/_data/schema.json   → drives admin form UI
src/_data/cms.json      → actual editable content (written by admin via GitHub API)
src/_data/site.json     → static metadata (title, url, author) — edit manually
```

Eleventy reads all three at build time. Templates access content as `cms.*`, `site.*`.

### Admin system (`/admin/`)

- `admin.js` contains three concerns: GitHub API client, form builder, live preview
- GitHub API calls are proxied through `/.netlify/functions/github-proxy` — the token never reaches the browser
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET` must be set as Netlify environment variables (or in `.env` for local dev)
- No client-side config; the admin requires no setup from the user
- Save = base64-encode cms.json → proxy → GitHub Contents API → Netlify rebuild triggered
- Live preview: iframe at `?preview=1` + `postMessage` to update `[data-cms-path]` elements without reload

### Templates

- All pages use `src/_includes/layouts/base.njk`
- Editable content elements must have `data-cms-path="cms.path.to.value"` for live preview to work
- Array items use `loop.index0` for the index in `data-cms-path`, e.g. `cms.home.sections.0.heading`

### Schema field types

| Type | Usage |
|---|---|
| `text` | Single-line input |
| `textarea` | Multi-line input |
| Object | Nested group — just a plain object in schema |
| Array | `_type: "array"` with `_item` defining the per-item schema. Optional: `min`, `max` (item count limits), `allow_add` (default true), `allow_remove` (default true), `allow_reorder` (default false), `add_to_top` (default false), `_single_field` (default false — when true, `_item` is a single leaf field and the array stores plain values instead of objects, e.g. `["url1", "url2"]`) |

## Key files

| File | Role |
|---|---|
| `.eleventy.js` | Passthrough copies: `src/assets`, `admin/`, `src/_data/schema.json → admin/schema.json` |
| `src/_data/cms.json` | Content — do not hand-edit if admin is working |
| `src/_data/schema.json` | Form structure — edit this to add/remove editable fields |
| `src/_data/site.json` | Site metadata — edit manually per project |
| `admin/admin.js` | All admin logic (GitHub API proxy calls, form builder, preview) |
| `netlify/functions/github-proxy.js` | Serverless proxy — forwards read/write to GitHub using server-side env vars |
| `netlify.toml` | Build config + functions directory declaration |

## When duplicating for a new project

1. Update `site.json` — title, url, author
2. Update `schema.json` — match the new site's content structure
3. Update `cms.json` — initial content matching the schema
4. Add `.njk` pages, wire up `data-cms-path` attributes on editable elements
5. Push to GitHub, connect to Netlify
6. In Netlify → Site Settings → Environment Variables, set:
   - `GITHUB_TOKEN` — fine-grained PAT with Contents: Read & Write on the repo
   - `GITHUB_OWNER` — GitHub username or org
   - `GITHUB_REPO` — repository name
   - `GITHUB_BRANCH` — branch to commit to (default: `main`)
   - `CLOUDINARY_CLOUD_NAME` — Cloudinary cloud name (optional, for image uploads)
   - `CLOUDINARY_UPLOAD_PRESET` — unsigned upload preset (optional, for image uploads)
7. For local CMS editing, create a `.env` file at the project root with the same variables and run `npm run dev` (requires `netlify-cli` installed globally: `npm i -g netlify-cli`)

## Conventions

- Content keys in `cms.json` match path segments in `data-cms-path` exactly
- Schema keys must match `cms.json` keys — no validation at build time yet
- GitHub credentials live server-side only; the browser never sees the token
