/* eleventy-cms-admin v1.2.19 */
// ── Cloud config (fetched from proxy on init) ─────────────────────────────────
let _cloudConfig = { cloudName: '', uploadPreset: '' };

// ── Auth ──────────────────────────────────────────────────────────────────────
let _authToken = null;
const Auth = {
  getUser: () => window.netlifyIdentity?.currentUser() ?? null,
  async refreshToken() {
    const user = this.getUser();
    if (!user) return null;
    _authToken = await user.jwt();
    return _authToken;
  },
};

// ── GitHub API ────────────────────────────────────────────────────────────────
const GitHub = {
  _endpoint: '/.netlify/functions/github-proxy',

  async _authHeaders() {
    const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocalDev) return {};
    const token = await Auth.refreshToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  async read(repoPath) {
    const res = await fetch(`${this._endpoint}?path=${encodeURIComponent(repoPath)}`, { headers: await this._authHeaders() });
    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = e.message || JSON.stringify(e); } catch (_) {}
      throw new Error(`GitHub read failed: ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
    }
    const data = await res.json();
    return { content: b64decode(data.content), sha: data.sha };
  },

  async write(repoPath, newContent, sha, commitMessage) {
    const body = { path: repoPath, message: commitMessage, content: b64encode(newContent) };
    if (sha) body.sha = sha;
    const res = await fetch(this._endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...await this._authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub write failed: ${res.status}`);
    }
    const data = await res.json();
    return data.content.sha;
  },

  async list(repoPath) {
    const res = await fetch(`${this._endpoint}?path=${encodeURIComponent(repoPath)}`, { headers: await this._authHeaders() });
    if (!res.ok) throw new Error(`GitHub list failed: ${res.status} ${res.statusText}`);
    return res.json(); // GitHub returns an array for directory paths
  },

  async delete(repoPath, sha, commitMessage) {
    const res = await fetch(this._endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...await this._authHeaders() },
      body: JSON.stringify({ path: repoPath, message: commitMessage, sha }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub delete failed: ${res.status}`);
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64decode(str) {
  return decodeURIComponent(escape(atob(str.replace(/\s/g, ''))));
}

function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((cur, key) => cur?.[key], obj);
}

function setPath(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const nextIsIndex = !isNaN(Number(keys[i + 1]));
    if (cur[k] === undefined || cur[k] === null) {
      cur[k] = nextIsIndex ? [] : {};
    }
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  cur[last] = value;
}

function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Form builder ──────────────────────────────────────────────────────────────

/**
 * Recursively build form fields from a schema node + matching data node.
 * @param {object} schemaNode
 * @param {*}      dataNode   current value(s) from cms.json
 * @param {HTMLElement} container  DOM element to append into
 * @param {string} pathPrefix  dot-notation path to this node (e.g. "home.hero")
 */
function buildForm(schemaNode, dataNode, container, pathPrefix) {
  if (!schemaNode || typeof schemaNode !== 'object') return;
  // Leaf field
  if (schemaNode.type) {
    container.appendChild(makeField(schemaNode, dataNode, pathPrefix));
    return;
  }

  // Array
  if (schemaNode._type === 'array') {
    const items = Array.isArray(dataNode) ? dataNode : [];
    const allowAdd     = schemaNode.allow_add     !== false;
    const allowRemove  = schemaNode.allow_remove  !== false;
    const allowReorder = schemaNode.allow_reorder === true;
    const addToTop     = schemaNode.add_to_top    === true;
    const min = schemaNode.min ?? null;
    const max = schemaNode.max ?? null;
    const singleField  = schemaNode._single_field === true;

    const listEl = document.createElement('div');
    listEl.className = 'array-list';
    listEl.dataset.arrayPath = pathPrefix;
    listEl.dataset.arraySchema = JSON.stringify(schemaNode._item);
    if (min !== null) listEl.dataset.arrayMin = String(min);
    if (max !== null) listEl.dataset.arrayMax = String(max);
    listEl.dataset.arrayAllowReorder = String(allowReorder);
    listEl.dataset.arraySingleField  = String(singleField);

    items.forEach((itemData, i) => {
      listEl.appendChild(makeArrayItem(schemaNode._item, itemData, `${pathPrefix}.${i}`, { allowRemove, allowReorder, singleField }));
    });

    container.appendChild(listEl);

    let addBtn = null;
    if (allowAdd) {
      addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-outline array-add-btn';
      addBtn.textContent = '+ Add item';
      addBtn.addEventListener('click', () => {
        const count = listEl.querySelectorAll(':scope > .array-item').length;
        if (max !== null && count >= max) return;
        const newItem = makeArrayItem(schemaNode._item, singleField ? null : {}, `${pathPrefix}.${count}`, { allowRemove, allowReorder, singleField });
        if (addToTop) {
          listEl.prepend(newItem);
          reindexArray(listEl);
        } else {
          listEl.appendChild(newItem);
        }
        updateArrayControls(listEl, addBtn);
      });
      container.appendChild(addBtn);
    }

    if (schemaNode.bulk_upload && !singleField) {
      const imageFieldKey = resolveBulkImageField(schemaNode._item);
      if (imageFieldKey) {
        const bulkLabel = document.createElement('label');
        bulkLabel.className = 'btn btn-outline array-bulk-upload-btn';
        bulkLabel.textContent = '↑ Upload Images';
        const bulkInput = document.createElement('input');
        bulkInput.type = 'file';
        bulkInput.multiple = true;
        bulkInput.accept = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';
        bulkInput.style.display = 'none';
        bulkLabel.appendChild(bulkInput);
        container.appendChild(bulkLabel);

        const bulkProgressArea = document.createElement('div');
        bulkProgressArea.className = 'media-lib-page__upload-progress';
        bulkProgressArea.hidden = true;
        const bpLabel = document.createElement('span');
        bpLabel.className = 'ml-progress-label';
        const bpTrack = document.createElement('div');
        bpTrack.className = 'progress-bar';
        const bpFill = document.createElement('div');
        bpFill.className = 'progress-bar__fill';
        bpTrack.appendChild(bpFill);
        bulkProgressArea.appendChild(bpLabel);
        bulkProgressArea.appendChild(bpTrack);
        container.appendChild(bulkProgressArea);

        bulkInput.addEventListener('change', (e) => {
          handleBulkArrayUpload(listEl, schemaNode._item, imageFieldKey, e.target.files, bulkProgressArea, { allowRemove, allowReorder, singleField }, addBtn, max);
          e.target.value = '';
        });
      }
    }

    updateArrayControls(listEl, addBtn);
    return;
  }

  // Object — group with fieldset
  const fs = document.createElement('fieldset');
  fs.className = 'group';
  const legend = document.createElement('legend');
  // Derive a readable label from the last path segment
  legend.textContent = pathPrefix.split('.').pop().replace(/-/g, ' ');
  fs.appendChild(legend);

  for (const key of Object.keys(schemaNode)) {
    if (key.startsWith('_')) continue;
    buildForm(schemaNode[key], dataNode?.[key], fs, `${pathPrefix}.${key}`);
  }

  container.appendChild(fs);
}

function makeField(fieldSchema, value, path) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field' + (fieldSchema.size === 'small' ? ' field--small' : '');

  const label = document.createElement('label');
  label.textContent = fieldSchema.label;
  wrapper.appendChild(label);

  let input;
  if (fieldSchema.type === 'textarea') {
    input = document.createElement('textarea');
    input.value = value ?? '';
  } else if (fieldSchema.type === 'image') {
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.dataset.path = path;
    hiddenInput.value = value ?? '';

    const thumb = document.createElement('img');
    thumb.className = 'image-field__thumb';
    thumb.src = value || '';
    thumb.alt = fieldSchema.label;
    thumb.hidden = !value;

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn btn-outline image-field__btn';
    uploadBtn.textContent = value ? 'Replace image' : 'Upload image';

    uploadBtn.addEventListener('click', () => {
      openMediaModal({ hiddenInput, thumb, uploadBtn });
    });

    wrapper.appendChild(thumb);
    wrapper.appendChild(uploadBtn);
    wrapper.appendChild(hiddenInput);
    return wrapper;
  } else if (fieldSchema.type === 'select') {
    input = document.createElement('select');
    (fieldSchema.options || []).forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      input.appendChild(o);
    });
  } else if (fieldSchema.type === 'boolean') {
    const switchLabel = document.createElement('label');
    switchLabel.className = 'toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.path = path;
    checkbox.checked = !!value;
    const track = document.createElement('span');
    track.className = 'toggle__track';
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(track);
    wrapper.appendChild(switchLabel);
    return wrapper;
  } else if (fieldSchema.type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
    input.value = value ?? '';
  } else if (fieldSchema.type === 'color') {
    input = document.createElement('input');
    input.type = 'color';
    input.value = value || '#000000';
  } else if (fieldSchema.type === 'date') {
    input = document.createElement('input');
    input.type = 'date';
    input.value = value || '';
  } else if (fieldSchema.type === 'richtext') {
    const richtextWrapper = document.createElement('div');
    richtextWrapper.className = 'richtext-field';
    const toolbar = document.createElement('div');
    toolbar.className = 'richtext-toolbar';
    [
      { cmd: 'bold',                label: 'B',      title: 'Bold' },
      { cmd: 'italic',              label: 'I',      title: 'Italic' },
      { cmd: 'insertUnorderedList', label: '• List', title: 'Bullet list' },
      { cmd: 'insertOrderedList',   label: '1. List', title: 'Numbered list' },
      { cmd: 'createLink',          label: 'Link',   title: 'Insert link' },
      { cmd: 'removeFormat',        label: 'Clear',  title: 'Clear formatting' },
    ].forEach(({ cmd, label, title }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'richtext-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        if (cmd === 'createLink') {
          const url = prompt('Enter URL:');
          if (url) document.execCommand('createLink', false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
      });
      toolbar.appendChild(btn);
    });
    const editor = document.createElement('div');
    editor.className = 'richtext-editor';
    editor.contentEditable = 'true';
    editor.innerHTML = value || '';
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.dataset.path = path;
    hiddenInput.value = value || '';
    editor.addEventListener('input', () => { hiddenInput.value = editor.innerHTML; });
    richtextWrapper.appendChild(toolbar);
    richtextWrapper.appendChild(editor);
    richtextWrapper.appendChild(hiddenInput);
    wrapper.appendChild(richtextWrapper);
    return wrapper;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
  }
  input.dataset.path = path;
  wrapper.appendChild(input);
  return wrapper;
}

function makeArrayItem(itemSchema, itemData, pathPrefix, { allowRemove = true, allowReorder = false, singleField = false } = {}) {
  const item = document.createElement('div');
  item.className = 'array-item';

  const header = document.createElement('div');
  header.className = 'array-item__header';
  const indexLabel = document.createElement('span');
  indexLabel.className = 'array-item__label';
  indexLabel.textContent = `Item ${pathPrefix.split('.').pop()}`;
  header.appendChild(indexLabel);

  if (allowReorder) {
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn btn-ghost array-up-btn';
    upBtn.textContent = '↑';
    upBtn.setAttribute('aria-label', 'Move up');
    upBtn.addEventListener('click', () => {
      const listEl = item.closest('.array-list');
      const prev = item.previousElementSibling;
      if (prev?.classList.contains('array-item')) {
        listEl.insertBefore(item, prev);
        reindexArray(listEl);
        updateArrayControls(listEl, listEl.nextElementSibling?.classList.contains('array-add-btn') ? listEl.nextElementSibling : null);
      }
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn btn-ghost array-down-btn';
    downBtn.textContent = '↓';
    downBtn.setAttribute('aria-label', 'Move down');
    downBtn.addEventListener('click', () => {
      const listEl = item.closest('.array-list');
      const next = item.nextElementSibling;
      if (next?.classList.contains('array-item')) {
        listEl.insertBefore(next, item);
        reindexArray(listEl);
        updateArrayControls(listEl, listEl.nextElementSibling?.classList.contains('array-add-btn') ? listEl.nextElementSibling : null);
      }
    });

    header.appendChild(upBtn);
    header.appendChild(downBtn);
  }

  if (allowRemove) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-ghost array-remove-btn';
    removeBtn.textContent = '✕ Remove';
    removeBtn.addEventListener('click', () => {
      const listEl = item.closest('.array-list');
      const addBtn = listEl.nextElementSibling?.classList.contains('array-add-btn') ? listEl.nextElementSibling : null;
      item.remove();
      reindexArray(listEl);
      updateArrayControls(listEl, addBtn);
    });
    header.appendChild(removeBtn);
  }

  item.appendChild(header);

  if (singleField) {
    item.appendChild(makeField(itemSchema, itemData ?? null, pathPrefix));
  } else {
    for (const key of Object.keys(itemSchema)) {
      buildForm(itemSchema[key], itemData?.[key], item, `${pathPrefix}.${key}`);
    }
  }

  return item;
}

function updateArrayControls(listEl, addBtn) {
  const count = listEl.querySelectorAll(':scope > .array-item').length;
  const min = listEl.dataset.arrayMin !== undefined ? parseInt(listEl.dataset.arrayMin) : null;
  const max = listEl.dataset.arrayMax !== undefined ? parseInt(listEl.dataset.arrayMax) : null;
  const allowReorder = listEl.dataset.arrayAllowReorder === 'true';

  if (addBtn) addBtn.disabled = max !== null && count >= max;

  const atMin = min !== null && count <= min;
  listEl.querySelectorAll(':scope > .array-item .array-remove-btn').forEach(btn => {
    btn.disabled = atMin;
  });

  if (allowReorder) {
    const items = listEl.querySelectorAll(':scope > .array-item');
    items.forEach((it, i) => {
      const upBtn = it.querySelector('.array-up-btn');
      const downBtn = it.querySelector('.array-down-btn');
      if (upBtn) upBtn.disabled = i === 0;
      if (downBtn) downBtn.disabled = i === items.length - 1;
    });
  }
}

function reindexArray(listEl) {
  const pathBase = listEl.dataset.arrayPath;
  const singleField = listEl.dataset.arraySingleField === 'true';
  const items = listEl.querySelectorAll(':scope > .array-item');
  items.forEach((item, i) => {
    const label = item.querySelector('.array-item__label');
    if (label) label.textContent = `Item ${i}`;
    item.querySelectorAll('[data-path]').forEach(el => {
      if (singleField) {
        // Path is exactly pathBase.oldIndex with no trailing sub-key
        el.dataset.path = el.dataset.path.replace(
          new RegExp(`^${escapeRegex(pathBase)}\\.\\d+$`),
          `${pathBase}.${i}`
        );
      } else {
        el.dataset.path = el.dataset.path.replace(
          new RegExp(`^${escapeRegex(pathBase)}\\.\\d+\\.`),
          `${pathBase}.${i}.`
        );
      }
    });
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Iterate a schema object's top-level keys and build each field directly into
// container without wrapping in a fieldset. Used for collection item forms so
// the synthetic path prefix (__file__*, __folder__*) never appears as a legend.
function buildFields(schemaFields, dataNode, container, pathPrefix) {
  for (const key of Object.keys(schemaFields)) {
    if (key.startsWith('_')) continue;
    buildForm(schemaFields[key], dataNode?.[key], container, `${pathPrefix}.${key}`);
  }
}

// ── Value collection ──────────────────────────────────────────────────────────
function collectValues() {
  const result = {};
  document.querySelectorAll('#form-area [data-path]').forEach(el => {
    setPath(result, el.dataset.path, el.type === 'checkbox' ? el.checked : el.value);
  });
  return result;
}

// ── Form area tabs ────────────────────────────────────────────────────────────
function switchFormTab(tab) {
  document.querySelectorAll('.form-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const contentPanel = document.getElementById('form-content-panel');
  const seoPanel = document.getElementById('form-seo-panel');
  if (contentPanel) contentPanel.hidden = tab !== 'content';
  if (seoPanel) seoPanel.hidden = tab !== 'seo';
}

function buildSeoForm(seoData, pageKey, container) {
  const fields = [
    { key: 'title',       type: 'text',     label: 'Page Title' },
    { key: 'description', type: 'textarea', label: 'Meta Description' },
    { key: 'ogImage',     type: 'image',    label: 'Social Share Image (og:image)' },
  ];
  fields.forEach(({ key, type, label }) => {
    container.appendChild(makeField({ type, label }, seoData?.[key], `${pageKey}.seo.${key}`));
  });
}

// ── App state ─────────────────────────────────────────────────────────────────
let _currentPage = null;
let _schema = null;
let _cmsSha = null;
let _activeImageField = null;
let _mediaCache = null;
let _mediaPageCache = null; // { uploads: [...], sha }

// Collection mode state
let _mode = 'page'; // 'page' | 'file-item' | 'folder-list' | 'folder-item' | 'media-library'
let _currentFileItem = null;         // { collectionKey, file, sha }
let _currentFolderCollection = null; // { collectionKey, collectionSchema }
let _currentFolderItem = null;       // { collectionKey, collectionSchema, repoPath, sha, isNew, slug }

// ── UI visibility helpers ─────────────────────────────────────────────────────
function setPreviewVisible(on) {
  document.getElementById('preview-pane').hidden = !on;
  document.querySelector('.admin-layout').classList.toggle('admin-layout--preview', on);
}

function setFormNavVisible(on) {
  const el = document.querySelector('.form-page-header');
  if (el) el.hidden = !on;
}

function setSaveBtnVisible(on) {
  document.getElementById('save-btn').hidden = !on;
}

function setActiveSidebarItem(navId) {
  document.querySelectorAll('.page-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.navId === navId)
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar(schema) {
  const aside = document.getElementById('sidebar');
  aside.innerHTML = '';

  function makeLabel(text) {
    const p = document.createElement('p');
    p.className = 'admin-sidebar__label';
    p.textContent = text;
    return p;
  }

  function makeBtn(navId, text, onClick, isSub = false) {
    const btn = document.createElement('button');
    btn.className = isSub ? 'page-tab page-tab--sub' : 'page-tab';
    btn.dataset.navId = navId;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  const collections = schema._collections || [];
  const topColls = collections.filter(c => !c._parent);
  const subColls = collections.filter(c => c._parent);

  const pageKeys = Object.keys(schema).filter(k => !k.startsWith('_'));
  const topPageKeys = pageKeys.filter(k => !schema[k]._parent);
  const subPageKeys = pageKeys.filter(k => schema[k]._parent);

  if (pageKeys.length) {
    aside.appendChild(makeLabel('Pages'));
    topPageKeys.forEach(k => {
      aside.appendChild(makeBtn(k, k, () => loadPage(k)));
      subPageKeys
        .filter(sk => schema[sk]._parent === k)
        .forEach(sk => aside.appendChild(makeBtn(sk, sk, () => loadPage(sk), true)));
      subColls
        .filter(c => c._parent === k && c.folder)
        .forEach(c => aside.appendChild(makeBtn(`folder:${c.name}`, c.label || c.name, () => loadFolderList(c.name, c), true)));
    });
    // Sub-pages whose _parent key doesn't exist — render at end of pages section unfindented
    subPageKeys
      .filter(sk => !topPageKeys.includes(schema[sk]._parent))
      .forEach(sk => aside.appendChild(makeBtn(sk, sk, () => loadPage(sk))));
  }

  for (const coll of topColls) {
    if (coll.files) {
      aside.appendChild(makeLabel(coll.label || coll.name));
      coll.files.forEach(f =>
        aside.appendChild(makeBtn(`file:${coll.name}:${f.name}`, f.label || f.name, () => loadFileItem(coll.name, f)))
      );
    } else if (coll.folder) {
      aside.appendChild(makeBtn(`folder:${coll.name}`, coll.label || coll.name, () => loadFolderList(coll.name, coll)));
    }
  }

  const footer = document.createElement('div');
  footer.className = 'admin-sidebar__footer';
  const mediaBtn = document.createElement('button');
  mediaBtn.className = 'page-tab';
  mediaBtn.dataset.navId = '__media-library__';
  mediaBtn.textContent = 'media library';
  mediaBtn.addEventListener('click', () => loadMediaLibraryPage());
  footer.appendChild(mediaBtn);
  aside.appendChild(footer);
}

// ── Page loading ──────────────────────────────────────────────────────────────
async function loadPage(pageKey) {
  _mode = 'page';
  _currentPage = pageKey;
  _currentFileItem = null;
  _currentFolderCollection = null;
  _currentFolderItem = null;

  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Loading…</p>';

  setActiveSidebarItem(pageKey);
  setPreviewVisible(true);
  setFormNavVisible(true);
  setSaveBtnVisible(true);
  switchFormTab('content');

  try {
    if (!_schema) {
      const res = await fetch('./schema.json');
      if (!res.ok) throw new Error(`Could not load schema: ${res.status}`);
      _schema = await res.json();
    }

    const { content: cmsContent, sha } = await GitHub.read('src/_data/cms.json');
    const cmsData = JSON.parse(cmsContent);
    _cmsSha = sha;

    formArea.innerHTML = '';

    const pageHeader = document.createElement('div');
    pageHeader.className = 'form-page-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'form-page-title';
    titleEl.textContent = pageKey.replace(/-/g, ' ');
    const tabsEl = document.createElement('div');
    tabsEl.className = 'form-page-tabs';
    ['content', 'seo'].forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'form-tab' + (tab === 'content' ? ' active' : '');
      btn.dataset.tab = tab;
      btn.textContent = tab === 'content' ? 'Content' : 'SEO';
      btn.addEventListener('click', () => switchFormTab(btn.dataset.tab));
      tabsEl.appendChild(btn);
    });
    pageHeader.appendChild(titleEl);
    pageHeader.appendChild(tabsEl);
    formArea.appendChild(pageHeader);

    const contentPanel = document.createElement('div');
    contentPanel.id = 'form-content-panel';
    for (const key of Object.keys(_schema[pageKey])) {
      if (key.startsWith('_')) continue;
      buildForm(_schema[pageKey][key], cmsData[pageKey]?.[key], contentPanel, `${pageKey}.${key}`);
    }
    formArea.appendChild(contentPanel);

    const seoPanel = document.createElement('div');
    seoPanel.id = 'form-seo-panel';
    seoPanel.hidden = true;
    buildSeoForm(cmsData[pageKey]?.seo, pageKey, seoPanel);
    formArea.appendChild(seoPanel);

    loadPreviewFrame();
  } catch (err) {
    formArea.innerHTML = `<p class="state-msg error">Error: ${err.message}</p>`;
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────
function loadPreviewFrame() {
  const frame = document.getElementById('preview-frame');
  const schema = _schema?.[_currentPage];
  const previewUrl = schema?._preview_url || (_currentPage === 'homepage' ? '/' : `/${_currentPage}/`);
  frame.onload = () => sendPreviewMessage();
  frame.src = `${window.location.origin}${previewUrl}?preview=1`;
}

function sendPreviewMessage() {
  const frame = document.getElementById('preview-frame');
  if (!frame.contentWindow) return;
  const values = {};
  document.querySelectorAll('#form-area [data-path]').forEach(el => {
    values['cms.' + el.dataset.path] = el.type === 'checkbox' ? el.checked : el.value;
  });
  frame.contentWindow.postMessage({ type: 'cms-preview', values }, '*');
}

// ── File collection ───────────────────────────────────────────────────────────
async function loadFileItem(collectionKey, fileItem) {
  _mode = 'file-item';
  _currentFileItem = { collectionKey, file: fileItem, sha: null };
  _currentPage = null;
  _currentFolderCollection = null;
  _currentFolderItem = null;

  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Loading…</p>';

  setActiveSidebarItem(`file:${collectionKey}:${fileItem.name}`);
  setPreviewVisible(false);
  setFormNavVisible(false);
  setSaveBtnVisible(true);
  switchFormTab('content');

  try {
    const { content, sha } = await GitHub.read(fileItem.file);
    const data = JSON.parse(content);
    _currentFileItem.sha = sha;

    formArea.innerHTML = '';
    const panel = document.createElement('div');
    panel.id = 'form-content-panel';
    buildFields(fileItem.fields, data, panel, `__file__${fileItem.name}`);
    formArea.appendChild(panel);
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      _currentFileItem.sha = null;
      formArea.innerHTML = '';
      const panel = document.createElement('div');
      panel.id = 'form-content-panel';
      buildForm(fileItem.fields, {}, panel, `__file__${fileItem.name}`);
      formArea.appendChild(panel);
    } else {
      formArea.innerHTML = `<p class="state-msg error">Error: ${err.message}</p>`;
    }
  }
}

async function saveFileItem() {
  const { file, sha } = _currentFileItem;
  const prefix = `__file__${file.name}`;

  const raw = collectValues();
  const data = raw[prefix] || {};

  let writeSha = sha;
  if (sha) {
    try {
      const { sha: freshSha } = await GitHub.read(file.file);
      writeSha = freshSha;
    } catch { /* file gone between load and save — create fresh */ writeSha = null; }
  }

  const newSha = await GitHub.write(
    file.file,
    JSON.stringify(data, null, 2),
    writeSha,
    `chore: update ${file.label || file.name} via admin`
  );
  _currentFileItem.sha = newSha;
}

// ── Folder collection — list view ─────────────────────────────────────────────
async function loadFolderList(collectionKey, collSchema) {
  _mode = 'folder-list';
  _currentFolderCollection = { collectionKey, collectionSchema: collSchema };
  _currentPage = null;
  _currentFileItem = null;
  _currentFolderItem = null;

  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Loading…</p>';

  setActiveSidebarItem(`folder:${collectionKey}`);
  setPreviewVisible(false);
  setFormNavVisible(false);
  setSaveBtnVisible(false);
  switchFormTab('content');

  try {
    const entries = await GitHub.list(collSchema.folder);
    const ext = collSchema.extension || 'json';
    const files = Array.isArray(entries)
      ? entries.filter(e => e.type === 'file' && e.name.endsWith(`.${ext}`))
      : [];

    if (collSchema.preview_field && files.length) {
      await Promise.all(files.map(async ghFile => {
        try {
          const { content } = await GitHub.read(ghFile.path);
          const data = JSON.parse(content);
          ghFile._preview = data[collSchema.preview_field] || null;
        } catch { /* leave _preview unset */ }
      }));
    }

    renderFolderList(formArea, collSchema, collectionKey, files);
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      renderFolderList(formArea, collSchema, collectionKey, []);
    } else {
      formArea.innerHTML = `<p class="state-msg error">Error: ${err.message}</p>`;
    }
  }
}

function renderFolderList(container, collSchema, collectionKey, githubFiles) {
  const ext = collSchema.extension || 'json';
  const canCreate = collSchema.create !== false;
  const canDelete = collSchema.delete !== false;
  const singular = collSchema.label_singular || collSchema.label || collectionKey;

  container.innerHTML = '';

  const view = document.createElement('div');
  view.className = 'collection-list-view';

  const header = document.createElement('div');
  header.className = 'collection-list-view__header';

  const title = document.createElement('h2');
  title.className = 'collection-list-view__title';
  title.textContent = collSchema.label || collectionKey;
  header.appendChild(title);

  const headerActions = document.createElement('div');
  headerActions.className = 'collection-list-view__actions';

  if (canCreate) {
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn btn-primary';
    newBtn.textContent = `+ New ${singular}`;
    newBtn.addEventListener('click', () => newFolderItem(collectionKey, collSchema));
    headerActions.appendChild(newBtn);
  }

  header.appendChild(headerActions);
  view.appendChild(header);

  const itemsEl = document.createElement('div');
  itemsEl.className = 'collection-list-view__items';

  if (githubFiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'state-msg';
    empty.textContent = `No ${(collSchema.label || collectionKey).toLowerCase()} yet.`;
    itemsEl.appendChild(empty);
  } else {
    githubFiles.forEach(ghFile => {
      const slug = ghFile.name.replace(new RegExp(`\\.${ext}$`), '');
      const repoPath = ghFile.path;

      const row = document.createElement('div');
      row.className = 'collection-list-item';

      const label = document.createElement('span');
      label.className = 'collection-list-item__title';
      label.textContent = ghFile._preview || slug;
      row.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'collection-list-item__actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-outline';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => loadFolderItem(collectionKey, collSchema, repoPath, slug));
      actions.appendChild(editBtn);

      if (canDelete) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-ghost btn-danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => deleteFolderItem(collectionKey, collSchema, repoPath, slug));
        actions.appendChild(delBtn);
      }

      row.appendChild(actions);
      itemsEl.appendChild(row);
    });
  }

  view.appendChild(itemsEl);
  container.appendChild(view);
}

// ── Folder collection — item form ─────────────────────────────────────────────
function renderFolderItemForm(container, collSchema, collectionKey, data, slug) {
  container.innerHTML = '';

  const backBar = document.createElement('div');
  backBar.className = 'collection-item-bar';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-ghost';
  backBtn.textContent = '← Back';
  backBtn.addEventListener('click', () => {
    loadFolderList(_currentFolderItem.collectionKey, _currentFolderItem.collectionSchema);
  });
  backBar.appendChild(backBtn);

  const slugInput = document.createElement('input');
  slugInput.type = 'text';
  slugInput.className = 'collection-item-bar__slug collection-item-bar__slug--editable';
  slugInput.value = slug;
  slugInput.setAttribute('aria-label', 'URL slug');
  slugInput.setAttribute('data-slug-input', '');
  if (_currentFolderItem && _currentFolderItem.isNew) slugInput.readOnly = true;
  backBar.appendChild(slugInput);
  container.appendChild(backBar);

  const panel = document.createElement('div');
  panel.id = 'form-content-panel';
  buildFields(collSchema.fields, data, panel, `__folder__${collectionKey}`);
  container.appendChild(panel);
}

async function loadFolderItem(collectionKey, collSchema, repoPath, slug) {
  _mode = 'folder-item';
  _currentFolderItem = { collectionKey, collectionSchema: collSchema, repoPath, sha: null, isNew: false, slug };
  _currentFolderCollection = { collectionKey, collectionSchema: collSchema };
  _currentPage = null;
  _currentFileItem = null;

  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Loading…</p>';

  setSaveBtnVisible(true);

  try {
    const { content, sha } = await GitHub.read(repoPath);
    const data = JSON.parse(content);
    _currentFolderItem.sha = sha;
    renderFolderItemForm(formArea, collSchema, collectionKey, data, slug);
  } catch (err) {
    formArea.innerHTML = `<p class="state-msg error">Error: ${err.message}</p>`;
  }
}

async function saveFolderItem() {
  const { collectionSchema, repoPath, sha, isNew, slug, collectionKey } = _currentFolderItem;
  const prefix = `__folder__${collectionKey}`;

  const raw = collectValues();
  const data = raw[prefix] || {};

  let finalPath = repoPath;

  // For new items with a slug_field, re-derive the filename from the field value
  if (isNew && collectionSchema.slug_field && data[collectionSchema.slug_field]) {
    const derivedSlug = slugify(String(data[collectionSchema.slug_field]));
    if (derivedSlug) {
      const ext = collectionSchema.extension || 'json';
      finalPath = `${collectionSchema.folder}/${derivedSlug}.${ext}`;
      _currentFolderItem.repoPath = finalPath;
      _currentFolderItem.slug = derivedSlug;
    }
  }

  // For existing items, check if the slug was edited and perform a rename if so
  if (!isNew) {
    const slugInputEl = document.querySelector('[data-slug-input]');
    if (slugInputEl) {
      const newSlug = slugify(slugInputEl.value);
      if (newSlug && newSlug !== slug) {
        const ext = collectionSchema.extension || 'json';
        const newPath = `${collectionSchema.folder}/${newSlug}.${ext}`;

        // Collision check
        try {
          await GitHub.read(newPath);
          alert(`An item with slug "${newSlug}" already exists. Choose a different slug.`);
          slugInputEl.value = slug;
          return;
        } catch (e) {
          if (!e.message.includes('404') && !e.message.includes('Not Found')) throw e;
        }

        // Write content to new path, then delete old file
        await GitHub.write(newPath, JSON.stringify(data, null, 2), null, `chore: rename ${slug} → ${newSlug} via admin`);
        const { sha: oldSha } = await GitHub.read(repoPath);
        await GitHub.delete(repoPath, oldSha, `chore: remove old slug ${slug} via admin`);

        _currentFolderItem.repoPath = newPath;
        _currentFolderItem.slug = newSlug;
        slugInputEl.value = newSlug;
        _currentFolderItem.sha = null;
        return;
      }
      // Snap input back to canonical form if user typed something invalid
      slugInputEl.value = slug;
    }
  }

  let writeSha = sha;
  if (sha) {
    try {
      const { sha: freshSha } = await GitHub.read(finalPath);
      writeSha = freshSha;
    } catch { writeSha = null; }
  }

  const newSha = await GitHub.write(
    finalPath,
    JSON.stringify(data, null, 2),
    writeSha,
    `chore: update ${_currentFolderItem.slug} via admin`
  );
  _currentFolderItem.sha = newSha;
  _currentFolderItem.isNew = false;
}

// ── Folder collection — new item ──────────────────────────────────────────────
async function newFolderItem(collectionKey, collSchema) {
  const singular = collSchema.label_singular || collSchema.label || 'item';
  const ext = collSchema.extension || 'json';

  const input = window.prompt(`Enter a URL-safe slug for the new ${singular}:`);
  if (input === null) return;

  const slug = slugify(input);
  if (!slug) {
    alert('Invalid slug. Use only letters, numbers, and hyphens.');
    return;
  }

  const repoPath = `${collSchema.folder}/${slug}.${ext}`;

  // Collision check
  try {
    await GitHub.read(repoPath);
    alert(`An item with slug "${slug}" already exists. Choose a different slug.`);
    return;
  } catch (err) {
    if (!err.message.includes('404') && !err.message.includes('Not Found')) {
      alert(`Could not check for existing file: ${err.message}`);
      return;
    }
  }

  _mode = 'folder-item';
  _currentFolderItem = { collectionKey, collectionSchema: collSchema, repoPath, sha: null, isNew: true, slug };
  _currentFolderCollection = { collectionKey, collectionSchema: collSchema };
  _currentPage = null;
  _currentFileItem = null;

  const formArea = document.getElementById('form-area');
  setSaveBtnVisible(true);
  renderFolderItemForm(formArea, collSchema, collectionKey, {}, slug);
}

// ── Folder collection — delete item ──────────────────────────────────────────
async function deleteFolderItem(collectionKey, collSchema, repoPath, slug) {
  if (!window.confirm(`Delete "${slug}"? This cannot be undone.`)) return;

  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Deleting…</p>';

  try {
    let sha;
    try {
      const result = await GitHub.read(repoPath);
      sha = result.sha;
    } catch (err) {
      if (err.message.includes('404') || err.message.includes('Not Found')) {
        // Already gone — just refresh the list
        await loadFolderList(collectionKey, collSchema);
        return;
      }
      throw err;
    }
    await GitHub.delete(repoPath, sha, `chore: delete ${slug} via admin`);
    await loadFolderList(collectionKey, collSchema);
  } catch (err) {
    formArea.innerHTML = `<p class="state-msg error">Delete failed: ${err.message}</p>`;
  }
}

// ── Save routing ──────────────────────────────────────────────────────────────
async function saveCurrent() {
  const saveBtn = document.getElementById('save-btn');
  const status = document.getElementById('save-status');

  saveBtn.disabled = true;
  status.textContent = 'Saving…';
  status.className = 'saving';

  try {
    if (_mode === 'page') await savePage();
    else if (_mode === 'file-item') await saveFileItem();
    else if (_mode === 'folder-item') await saveFolderItem();
    else if (_mode === 'media-library') return;

    status.textContent = 'Saved ✓';
    status.className = 'saved';
    setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'error';
  } finally {
    saveBtn.disabled = false;
  }
}

async function savePage() {
  const formValues = collectValues();

  const { content: latestContent, sha: latestSha } = await GitHub.read('src/_data/cms.json');
  const latestCms = JSON.parse(latestContent);
  const updatedCms = { ...latestCms, ...formValues };

  _cmsSha = await GitHub.write(
    'src/_data/cms.json',
    JSON.stringify(updatedCms, null, 2),
    latestSha,
    `chore: update ${_currentPage} content via admin`
  );
}

// ── Media modal ───────────────────────────────────────────────────────────────
function openMediaModal(fieldRefs) {
  _activeImageField = fieldRefs;
  document.getElementById('media-upload-trigger').hidden = false;
  document.getElementById('media-upload-loading').hidden = true;
  switchMediaTab('upload');
  document.getElementById('media-modal').showModal();
}

function switchMediaTab(tab) {
  document.querySelectorAll('.media-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('media-panel-upload').hidden = tab !== 'upload';
  document.getElementById('media-panel-library').hidden = tab !== 'library';
  if (tab === 'library') {
    document.getElementById('media-library-search').value = '';
    loadMediaLibrary();
  }
}

function selectImage(url) {
  if (!_activeImageField) return;
  _activeImageField.hiddenInput.value = url;
  _activeImageField.thumb.src = url;
  _activeImageField.thumb.hidden = false;
  _activeImageField.uploadBtn.textContent = 'Replace image';
  sendPreviewMessage();
  document.getElementById('media-modal').close();
  _activeImageField = null;
}

async function loadMediaLibrary() {
  const grid = document.getElementById('media-library-grid');
  const search = document.getElementById('media-library-search');

  const render = (term) => {
    const filtered = term
      ? _mediaCache.filter(u => u.filename.toLowerCase().includes(term.toLowerCase()))
      : _mediaCache;
    renderMediaGrid(grid, filtered, term);
  };

  if (_mediaCache) { render(search.value); return; }
  grid.innerHTML = '<p class="state-msg">Loading…</p>';
  try {
    const { content } = await GitHub.read('src/_data/media.json');
    _mediaCache = JSON.parse(content).uploads || [];
    render('');
  } catch (err) {
    grid.innerHTML = `<p class="state-msg error">Could not load library: ${err.message}</p>`;
  }

  search.oninput = () => render(search.value.trim());
}

function renderMediaGrid(grid, uploads, term = '') {
  if (uploads.length === 0) {
    grid.innerHTML = term
      ? `<p class="state-msg">No images match "<em>${term}</em>".</p>`
      : '<p class="state-msg">No images yet. Upload one first.</p>';
    return;
  }
  grid.innerHTML = '';
  uploads.forEach(({ url, filename }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-thumb';
    btn.title = filename;
    const img = document.createElement('img');
    img.src = url;
    img.alt = filename;
    btn.appendChild(img);
    btn.addEventListener('click', () => selectImage(url));
    grid.appendChild(btn);
  });
}

function cloudinaryPublicIdFromUrl(url) {
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
  return m ? m[1] : null;
}

function cloudinaryThumbUrl(url, maxWidth = 200) {
  return url.replace(/\/upload\//, `/upload/w_${maxWidth},c_limit,q_auto,f_auto/`);
}

async function appendToMediaLibrary(url, filename, publicId) {
  try {
    let uploads = [];
    let sha;
    try {
      const { content, sha: existingSha } = await GitHub.read('src/_data/media.json');
      uploads = JSON.parse(content).uploads || [];
      sha = existingSha;
    } catch { /* file missing — create it */ }
    const entry = { url, filename, uploadedAt: new Date().toISOString() };
    if (publicId) entry.publicId = publicId;
    uploads.unshift(entry);
    await GitHub.write(
      'src/_data/media.json',
      JSON.stringify({ uploads }, null, 2),
      sha,
      'chore: add image to media library'
    );
    _mediaCache = uploads;
  } catch (err) {
    console.error('Failed to save to media library:', err);
  }
}

async function appendToMediaLibraryAndPage(url, filename, publicId) {
  const entry = { url, filename, uploadedAt: new Date().toISOString() };
  if (publicId) entry.publicId = publicId;
  if (_mediaPageCache) _mediaPageCache.uploads.unshift(entry);
  if (_mediaCache) _mediaCache.unshift(entry);
  const uploads = _mediaPageCache?.uploads ?? [entry];
  const newSha = await GitHub.write(
    'src/_data/media.json',
    JSON.stringify({ uploads }, null, 2),
    _mediaPageCache?.sha ?? null,
    'chore: add image to media library'
  );
  if (_mediaPageCache) _mediaPageCache.sha = newSha;
}

// ── Cloudinary helpers (module-level for reuse by media library page) ─────────
const CLOUDINARY_MAX_BYTES = 10_000_000;
const CLOUDINARY_MAX_DIMENSION = 4096;

async function resizeImageIfNeeded(file) {
  if (file.size <= CLOUDINARY_MAX_BYTES) return file;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, CLOUDINARY_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (blob.size <= CLOUDINARY_MAX_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
    }
  }

  return new Promise(res => canvas.toBlob(b => res(
    new File([b], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
  ), 'image/jpeg', 0.5));
}

async function uploadToCloudinary(file) {
  const body = new FormData();
  body.append('file', file);
  body.append('upload_preset', _cloudConfig.uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${_cloudConfig.cloudName}/image/upload`, {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status}`);
  return res.json();
}

// ── Media Library page ────────────────────────────────────────────────────────
async function loadMediaLibraryPage() {
  _mode = 'media-library';
  _currentPage = null;
  _currentFileItem = null;
  _currentFolderCollection = null;
  _currentFolderItem = null;

  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Loading…</p>';

  setActiveSidebarItem('__media-library__');
  setPreviewVisible(false);
  setFormNavVisible(false);
  setSaveBtnVisible(false);

  try {
    const { content, sha } = await GitHub.read('src/_data/media.json');
    _mediaPageCache = { uploads: JSON.parse(content).uploads || [], sha };
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      _mediaPageCache = { uploads: [], sha: null };
    } else {
      formArea.innerHTML = `<p class="state-msg error">Error: ${err.message}</p>`;
      return;
    }
  }

  renderMediaLibraryPage(formArea);
}

function renderMediaLibraryPage(container) {
  const page = document.createElement('div');
  page.className = 'media-lib-page';

  // Header
  const header = document.createElement('div');
  header.className = 'media-lib-page__header';

  const title = document.createElement('h2');
  title.className = 'media-lib-page__title';
  title.textContent = 'media library';

  const count = document.createElement('span');
  count.className = 'media-lib-page__count';
  count.id = 'ml-count';
  count.textContent = `${_mediaPageCache.uploads.length} image${_mediaPageCache.uploads.length !== 1 ? 's' : ''}`;

  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'btn btn-ghost';
  selectAllBtn.id = 'ml-select-all';
  selectAllBtn.textContent = 'select all';

  const deleteSelectedBtn = document.createElement('button');
  deleteSelectedBtn.type = 'button';
  deleteSelectedBtn.className = 'btn btn-danger';
  deleteSelectedBtn.id = 'ml-delete-selected';
  deleteSelectedBtn.textContent = 'delete selected (0)';
  deleteSelectedBtn.hidden = true;

  const uploadLabel = document.createElement('label');
  uploadLabel.className = 'btn btn-primary';
  uploadLabel.textContent = 'upload images';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'ml-file-input';
  fileInput.multiple = true;
  fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml';
  fileInput.style.display = 'none';
  uploadLabel.appendChild(fileInput);

  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(selectAllBtn);
  header.appendChild(deleteSelectedBtn);
  header.appendChild(uploadLabel);

  // Upload progress
  const progressArea = document.createElement('div');
  progressArea.className = 'media-lib-page__upload-progress';
  progressArea.id = 'ml-upload-progress';
  progressArea.hidden = true;
  const progressLabel = document.createElement('span');
  progressLabel.className = 'ml-progress-label';
  const progressTrack = document.createElement('div');
  progressTrack.className = 'progress-bar';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-bar__fill';
  progressTrack.appendChild(progressFill);
  progressArea.appendChild(progressLabel);
  progressArea.appendChild(progressTrack);

  // Search
  const searchRow = document.createElement('div');
  searchRow.className = 'media-lib-page__search-row';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.id = 'ml-search';
  searchInput.placeholder = 'search images…';
  searchRow.appendChild(searchInput);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'media-lib-page__grid';
  grid.id = 'ml-grid';

  page.appendChild(header);
  page.appendChild(progressArea);
  page.appendChild(searchRow);
  page.appendChild(grid);

  container.innerHTML = '';
  container.appendChild(page);

  renderMediaLibraryGrid(grid, _mediaPageCache.uploads);

  // Event wiring
  fileInput.addEventListener('change', (e) => {
    handleMediaPageUpload(e.target.files);
    e.target.value = '';
  });

  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      renderMediaLibraryGrid(grid, _mediaPageCache.uploads, searchInput.value.trim());
    }, 200);
  });

  selectAllBtn.addEventListener('click', () => {
    const checkboxes = grid.querySelectorAll('.media-lib-item__checkbox');
    const allChecked = [...checkboxes].every(cb => cb.checked);
    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      cb.closest('.media-lib-item').classList.toggle('media-lib-item--selected', !allChecked);
    });
    updateBulkDeleteBtn();
  });

  deleteSelectedBtn.addEventListener('click', () => {
    const checked = grid.querySelectorAll('.media-lib-item__checkbox:checked');
    const items = [...checked].map(cb => cb.closest('.media-lib-item'));
    const urls = items.map(el => el.dataset.url);
    const filenames = items.map(el => el.dataset.filename);
    const publicIds = items.map(el => el.dataset.publicId || '').filter(Boolean);
    deleteMediaItems(urls, filenames, publicIds);
  });
}

function renderMediaLibraryGrid(gridEl, uploads, searchTerm = '') {
  const filtered = searchTerm
    ? uploads.filter(u => u.filename.toLowerCase().includes(searchTerm.toLowerCase()))
    : uploads;

  gridEl.innerHTML = '';

  if (filtered.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'state-msg';
    msg.textContent = searchTerm
      ? `No images match "${searchTerm}".`
      : 'No images yet. Upload some using the button above.';
    gridEl.appendChild(msg);
    return;
  }

  filtered.forEach(({ url, filename, publicId }) => {
    const item = document.createElement('div');
    item.className = 'media-lib-item';
    item.dataset.url = url;
    item.dataset.filename = filename;
    const pid = publicId || cloudinaryPublicIdFromUrl(url);
    if (pid) item.dataset.publicId = pid;

    const checkWrap = document.createElement('div');
    checkWrap.className = 'media-lib-item__check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'media-lib-item__checkbox';
    cb.setAttribute('aria-label', `Select ${filename}`);
    checkWrap.appendChild(cb);

    const img = document.createElement('img');
    img.className = 'media-lib-item__img';
    img.src = cloudinaryThumbUrl(url);
    img.alt = filename;
    img.loading = 'lazy';

    const overlay = document.createElement('div');
    overlay.className = 'media-lib-item__overlay';
    const nameEl = document.createElement('span');
    nameEl.className = 'media-lib-item__name';
    nameEl.textContent = filename;
    nameEl.title = filename;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'media-lib-item__delete';
    delBtn.textContent = 'delete';
    overlay.appendChild(nameEl);
    overlay.appendChild(delBtn);

    item.appendChild(checkWrap);
    item.appendChild(img);
    item.appendChild(overlay);

    item.addEventListener('click', (e) => {
      if (e.target === delBtn || delBtn.contains(e.target)) return;
      if (e.target === cb || checkWrap.contains(e.target)) return;
      cb.checked = !cb.checked;
      item.classList.toggle('media-lib-item--selected', cb.checked);
      updateBulkDeleteBtn();
    });

    cb.addEventListener('change', () => {
      item.classList.toggle('media-lib-item--selected', cb.checked);
      updateBulkDeleteBtn();
    });

    delBtn.addEventListener('click', () => deleteMediaItems([url], [filename], publicId ? [publicId] : []));

    gridEl.appendChild(item);
  });
}

function updateBulkDeleteBtn() {
  const count = document.querySelectorAll('#ml-grid .media-lib-item__checkbox:checked').length;
  const btn = document.getElementById('ml-delete-selected');
  if (!btn) return;
  btn.hidden = count === 0;
  btn.textContent = `delete selected (${count})`;
}

function updateMediaCount() {
  const el = document.getElementById('ml-count');
  if (!el || !_mediaPageCache) return;
  const n = _mediaPageCache.uploads.length;
  el.textContent = `${n} image${n !== 1 ? 's' : ''}`;
}

function resolveBulkImageField(itemSchema) {
  return Object.keys(itemSchema || {}).find(k => itemSchema[k].type === 'image') ?? null;
}

async function handleBulkArrayUpload(listEl, itemSchema, imageFieldKey, fileList, progressArea, options, addBtn, max) {
  if (!_cloudConfig.cloudName || !_cloudConfig.uploadPreset) {
    alert('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in Netlify environment variables.');
    return;
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  const files = Array.from(fileList).filter(f => allowed.includes(f.type));
  if (files.length === 0) {
    alert('No supported image files selected. Use JPG, PNG, WebP, GIF, or SVG.');
    return;
  }

  const currentCount = listEl.querySelectorAll(':scope > .array-item').length;
  const available = max !== null ? max - currentCount : Infinity;
  const toUpload = available > 0 ? files.slice(0, available) : [];
  if (toUpload.length === 0) {
    alert('This gallery is already at its maximum image count.');
    return;
  }

  const progressLabel = progressArea.querySelector('.ml-progress-label');
  const progressFill = progressArea.querySelector('.progress-bar__fill');
  progressArea.hidden = false;

  let completed = 0;
  const errors = [];

  for (const file of toUpload) {
    progressLabel.textContent = `Uploading ${completed + 1} of ${toUpload.length}…`;
    progressFill.style.width = `${(completed / toUpload.length) * 100}%`;

    try {
      const processed = await resizeImageIfNeeded(file);
      const result = await uploadToCloudinary(processed);
      const url = result.secure_url;
      const filename = result.original_filename || result.public_id;
      await appendToMediaLibrary(url, filename, result.public_id);

      const count = listEl.querySelectorAll(':scope > .array-item').length;
      const newPath = `${listEl.dataset.arrayPath}.${count}`;
      const newItem = makeArrayItem(itemSchema, { [imageFieldKey]: url }, newPath, options);
      listEl.appendChild(newItem);
      reindexArray(listEl);
      updateArrayControls(listEl, addBtn);
    } catch (err) {
      console.error(`Failed to upload ${file.name}:`, err);
      errors.push(file.name);
    }
    completed++;
  }

  progressFill.style.width = '100%';
  const successCount = completed - errors.length;
  progressLabel.textContent = errors.length
    ? `Done. ${successCount} uploaded, ${errors.length} failed.`
    : `Done. ${completed} image${completed !== 1 ? 's' : ''} uploaded.`;

  setTimeout(() => {
    progressArea.hidden = true;
    progressFill.style.width = '0%';
  }, 2500);
}

async function handleMediaPageUpload(fileList) {
  if (!_cloudConfig.cloudName || !_cloudConfig.uploadPreset) {
    alert('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in Netlify environment variables.');
    return;
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  const files = Array.from(fileList).filter(f => allowed.includes(f.type));
  if (files.length === 0) {
    alert('No supported image files selected. Use JPG, PNG, WebP, GIF, or SVG.');
    return;
  }

  const progressArea = document.getElementById('ml-upload-progress');
  const progressLabel = progressArea.querySelector('.ml-progress-label');
  const progressFill = progressArea.querySelector('.progress-bar__fill');
  const uploadLabel = document.querySelector('.media-lib-page label.btn-primary');

  progressArea.hidden = false;
  if (uploadLabel) uploadLabel.style.pointerEvents = 'none';

  let completed = 0;
  const errors = [];

  for (const file of files) {
    progressLabel.textContent = `Uploading ${completed + 1} of ${files.length}…`;
    progressFill.style.width = `${(completed / files.length) * 100}%`;

    try {
      const processed = await resizeImageIfNeeded(file);
      const data = await uploadToCloudinary(processed);
      const url = data.secure_url;
      const filename = data.original_filename || data.public_id;
      await appendToMediaLibraryAndPage(url, filename, data.public_id);
    } catch (err) {
      console.error(`Failed to upload ${file.name}:`, err);
      errors.push(file.name);
    }
    completed++;
  }

  progressFill.style.width = '100%';
  const successCount = completed - errors.length;
  progressLabel.textContent = errors.length
    ? `Done. ${successCount} uploaded, ${errors.length} failed.`
    : `Done. ${completed} image${completed !== 1 ? 's' : ''} uploaded.`;
  setTimeout(() => {
    progressArea.hidden = true;
    progressFill.style.width = '0%';
  }, 2500);

  if (uploadLabel) uploadLabel.style.pointerEvents = '';

  const gridEl = document.getElementById('ml-grid');
  const searchEl = document.getElementById('ml-search');
  if (gridEl) renderMediaLibraryGrid(gridEl, _mediaPageCache.uploads, searchEl?.value.trim() || '');
  updateMediaCount();
}

async function deleteMediaItems(urls, filenames, publicIds = []) {
  const label = urls.length === 1 ? `"${filenames[0]}"` : `${urls.length} images`;
  const cloudinaryNote = publicIds.length > 0
    ? 'Images will also be permanently deleted from Cloudinary.'
    : 'Note: images will remain on Cloudinary but will no longer appear in the library.';
  if (!window.confirm(`Remove ${label} from the media library?\n\n${cloudinaryNote}`)) return;

  if (_mediaPageCache) {
    _mediaPageCache.uploads = _mediaPageCache.uploads.filter(u => !urls.includes(u.url));
  }
  if (_mediaCache) {
    _mediaCache = _mediaCache.filter(u => !urls.includes(u.url));
  }

  try {
    const { sha } = await GitHub.read('src/_data/media.json');
    const uploads = _mediaPageCache?.uploads ?? [];
    const newSha = await GitHub.write(
      'src/_data/media.json',
      JSON.stringify({ uploads }, null, 2),
      sha,
      `chore: remove ${urls.length} image${urls.length !== 1 ? 's' : ''} from media library`
    );
    if (_mediaPageCache) _mediaPageCache.sha = newSha;
  } catch (err) {
    alert(`Failed to update media library: ${err.message}`);
    loadMediaLibraryPage();
    return;
  }

  if (publicIds.length > 0) {
    try {
      const res = await fetch('/.netlify/functions/github-proxy', {
        method: 'POST',
        headers: { ...(await GitHub._authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cloudinary-delete', publicIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Images removed from library but could not be deleted from Cloudinary: ${data.error || res.status}`);
      }
    } catch (err) {
      alert(`Images removed from library but could not be deleted from Cloudinary: ${err.message}`);
    }
  }

  const gridEl = document.getElementById('ml-grid');
  const searchEl = document.getElementById('ml-search');
  if (gridEl) renderMediaLibraryGrid(gridEl, _mediaPageCache.uploads, searchEl?.value.trim() || '');
  updateMediaCount();
  updateBulkDeleteBtn();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const formArea = document.getElementById('form-area');
  formArea.innerHTML = '<p class="state-msg">Loading…</p>';

  try {
    const [schemaRes, configRes] = await Promise.all([
      fetch('./schema.json'),
      fetch('/.netlify/functions/github-proxy', { headers: await GitHub._authHeaders() }).catch(() => null),
    ]);
    if (!schemaRes.ok) throw new Error(`Could not load schema: ${schemaRes.status}`);
    _schema = await schemaRes.json();
    if (configRes?.ok) {
      try { _cloudConfig = await configRes.json(); } catch (_) {}
    }

    const siteName = _schema._site?.name;
    if (siteName) {
      const siteLink = document.getElementById('site-name-link');
      siteLink.textContent = siteName;
    }

    renderSidebar(_schema);

    const pageKeys = Object.keys(_schema).filter(k => !k.startsWith('_'));
    if (pageKeys.length > 0) {
      loadPage(pageKeys[0]);
    } else {
      const collections = _schema._collections || [];
      const first = collections[0];
      if (first?.files?.length > 0) {
        loadFileItem(first.name, first.files[0]);
      } else if (first?.folder) {
        loadFolderList(first.name, first);
      } else {
        formArea.innerHTML = '<p class="state-msg">Select an item from the sidebar.</p>';
      }
    }
  } catch (err) {
    formArea.innerHTML = `<p class="state-msg error">Could not load: ${err.message}</p>`;
  }
}

// ── Wire up events on DOMContentLoaded ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-btn').addEventListener('click', saveCurrent);
  document.getElementById('preview-refresh-btn').addEventListener('click', loadPreviewFrame);

  document.getElementById('media-modal-close').addEventListener('click', () => {
    document.getElementById('media-modal').close();
  });
  document.querySelectorAll('.media-tab').forEach(btn => {
    btn.addEventListener('click', () => switchMediaTab(btn.dataset.tab));
  });
  document.getElementById('media-upload-trigger').addEventListener('click', () => {
    if (!_cloudConfig.cloudName || !_cloudConfig.uploadPreset) {
      alert('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in Netlify environment variables.');
      return;
    }
    document.getElementById('media-file-input').click();
  });

  document.getElementById('media-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      alert('Unsupported file type. Please choose a JPG, PNG, WebP, GIF, or SVG.');
      return;
    }

    const triggerBtn = document.getElementById('media-upload-trigger');
    const loadingEl  = document.getElementById('media-upload-loading');
    triggerBtn.hidden = true;
    loadingEl.hidden  = false;

    try {
      const processed = await resizeImageIfNeeded(file);
      if (processed.size > CLOUDINARY_MAX_BYTES) {
        alert('This file is too large to upload. Please use an image under 10 MB.');
        triggerBtn.hidden = false;
        loadingEl.hidden  = true;
        return;
      }
      const data = await uploadToCloudinary(processed);
      const url      = data.secure_url;
      const filename = data.original_filename || data.public_id;
      appendToMediaLibrary(url, filename, data.public_id);
      selectImage(url);
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      alert('Upload failed. Please try again.');
      triggerBtn.hidden = false;
      loadingEl.hidden  = true;
    }
  });

  let _previewDebounce = null;
  document.getElementById('form-area').addEventListener('input', () => {
    clearTimeout(_previewDebounce);
    _previewDebounce = setTimeout(sendPreviewMessage, 150);
  });
});

// ── Identity bootstrap ────────────────────────────────────────────────────────
// Runs immediately (not inside DOMContentLoaded) so we never miss the init
// event, which the widget fires before DOMContentLoaded in some browsers.
{
  const adminShell  = document.getElementById('admin-shell');
  const loginScreen = document.getElementById('login-screen');

  function showAdmin() {
    loginScreen.hidden = true;
    adminShell.hidden = false;
    init();
  }

  function showLogin() {
    loginScreen.hidden = false;
    adminShell.hidden = true;
  }

  document.getElementById('login-btn').addEventListener('click', () => {
    window.netlifyIdentity.open('login');
  });
  document.getElementById('logout-btn').addEventListener('click', () => {
    window.netlifyIdentity.logout();
  });

  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (isLocalDev) {
    showAdmin();
  } else {
    window.netlifyIdentity.init({
      APIUrl: `${window.location.origin}/.netlify/identity`
    });

    window.netlifyIdentity.on('init', async user => {
      if (user) { await Auth.refreshToken(); showAdmin(); }
      else showLogin();
    });
    window.netlifyIdentity.on('login', async () => {
      await Auth.refreshToken();
      window.netlifyIdentity.close();
      window.location.href = '/admin';
    });
    window.netlifyIdentity.on('logout', () => {
      _authToken = null;
      showLogin();
    });
  }
}
