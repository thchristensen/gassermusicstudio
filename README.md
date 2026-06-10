# Web Starter Template

A starter template for freelance web projects built with Eleventy, Nunjucks, and a custom headless CMS — designed to be duplicated at the start of every new project so the hard setup is already done.

## Stack

| Layer | Tool |
|---|---|
| Static site generator | [Eleventy (11ty) v3.x](https://www.11ty.dev/) |
| Templating | Nunjucks |
| Hosting | Netlify |
| CMS | Custom admin (replaces Decap CMS) |
| Content storage | JSON files committed to GitHub |

## How it works

Content lives in `src/_data/cms.json`. The admin UI reads and writes that file directly to GitHub via the GitHub REST API, which triggers a Netlify rebuild. No backend server required.

```
Admin UI (browser)
  → GitHub API (commit cms.json)
    → Netlify (rebuild triggered by push)
      → _site/ (static HTML served)
```

## Project structure

```
web-starter-template/
├── admin/                  # Browser-based CMS admin
│   ├── index.html          # Admin UI shell
│   ├── admin.js            # GitHub API + form builder + live preview
│   └── admin.css           # Admin styles
├── src/
│   ├── _data/
│   │   ├── cms.json        # Editable content (managed by admin)
│   │   ├── schema.json     # Defines the admin form structure
│   │   └── site.json       # Static site metadata (title, url, author)
│   ├── _includes/
│   │   ├── layouts/
│   │   │   └── base.njk    # Base HTML layout
│   │   └── components/
│   │       ├── header.njk
│   │       └── footer.njk
│   └── index.njk           # Home page
├── .eleventy.js            # Eleventy config
└── package.json
```

## Admin system

The admin is a single-page app at `/admin/`. It requires a one-time GitHub configuration stored in `localStorage`:

- GitHub owner / repo / branch
- Personal access token (needs Contents: read & write)
- Preview URL (local dev server URL for live preview)

### Content schema

`schema.json` defines the shape of the admin forms. Supported field types:

- `text` — single-line input
- `textarea` — multi-line input
- Objects — nested groups of fields
- Arrays — repeating groups (items can be added/removed)

### Live preview

The admin embeds an iframe pointing at the dev server with `?preview=1`. The page listens for `postMessage` updates and swaps content on elements marked with `data-cms-path` attributes — no page reload needed.

## Getting started (new project)

1. Duplicate this repo
2. Update `src/_data/site.json` with the new site's name, URL, and author
3. Update `src/_data/schema.json` to match the pages and fields needed
4. Update `src/_data/cms.json` with initial content matching the schema
5. Add pages under `src/` and wire up `data-cms-path` attributes
6. Connect to Netlify (build command: `npm run build`, publish dir: `_site/`)
7. Open `/admin/`, click Settings, enter GitHub credentials

## Development

```bash
npm install
npm start       # dev server at http://localhost:8080
npm run build   # production build → _site/
```

---

## Roadmap

### Phase 1 — Core CMS parity (Decap CMS replacement)
- [ ] `netlify.toml` with correct build settings and redirect rules
- [ ] Image upload support (upload to GitHub repo assets folder)
- [ ] Rich text (Markdown) field type in the admin form builder
- [ ] Admin authentication (Netlify Identity or GitHub OAuth instead of raw PAT)
- [ ] Slug / URL field type (auto-generated from title)
- [ ] Date / datetime field type
- [ ] Select / dropdown field type
- [ ] Toggle / boolean field type
- [ ] Admin validation: required fields, max length

### Phase 2 — Multi-page support
- [ ] Collection support: add/remove pages from a defined page type (e.g. blog posts)
- [ ] Sidebar navigation auto-generated from schema pages
- [ ] Per-page preview URL routing in the live preview pane
- [ ] Draft / published status per page or per collection item

### Phase 3 — Template polish
- [ ] Base CSS reset / design tokens (consistent starting point for every project)
- [ ] Additional starter components: nav, hero, cards, contact form
- [ ] SEO defaults: Open Graph tags, canonical URL, sitemap, robots.txt
- [ ] Netlify Forms integration for contact forms
- [ ] 404 page
- [ ] Favicon boilerplate

### Phase 4 — Developer experience
- [ ] CLAUDE.md kept up to date as canonical dev reference
- [ ] Schema validation on build (catch cms.json / schema.json mismatches early)
- [ ] Admin field: inline schema editor so non-developers can add fields
- [ ] Branching / staging: preview Netlify deploy per branch
- [ ] Automated Netlify deploy status shown in admin

### Known limitations / decisions
- GitHub PAT is stored in `localStorage` — acceptable for personal/single-editor sites, not suitable for multi-user teams
- No offline support; admin requires network access to GitHub API
- Netlify rebuild takes ~30–60 seconds after a save before the live site updates
