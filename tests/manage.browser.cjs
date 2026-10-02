const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost:8765/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = root + pathname;
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    await route.fulfill({ contentType: type, body: fs.readFileSync(file) });
  });
  await page.addInitScript(() => {
    const date = '2026-09-20T00:00:00.000Z';
    const marker = (id, time, note) => ({ id, time, note, createdAt: date, updatedAt: date });
    window.__db = {
      settings: { recentDays: 14, recentEpisodes: 2 }, markerMode: 'edit',
      'videos:youtube:abcdefghijk': { site: 'youtube', title: '交通議題影片 A', pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', pickedAt: '2026-10-01T00:00:00.000Z' },
      'markers:youtube:abcdefghijk': [marker('a1', 68, '開場'), marker('a2', 320, '交通政策')],
      'videos:tcc:123': { site: 'tcc', title: '預算影片 B', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=123' },
      'markers:tcc:123': [marker('b1', 190, '預算說明')],
      'videos:tcc:456': { site: 'tcc', title: 'backlog 影片 C', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=456' },
      'markers:tcc:456': [marker('c1', 42, '待整理片段')],
      'episode:1': { id: '1', name: 'ep1', videoKeys: ['youtube:abcdefghijk'], createdAt: date, updatedAt: date },
      'episode:2': { id: '2', name: 'ep2', videoKeys: ['tcc:123'], createdAt: date, updatedAt: date },
      'episode:11': { id: '11', name: 'ep11', videoKeys: ['youtube:abcdefghijk'], createdAt: date, updatedAt: date },
      'order:2026-09-20': ['youtube:abcdefghijk']
    };
    const listeners = [];
    const clone = value => structuredClone(value);
    window.chrome = {
      runtime: { getManifest: () => ({ version: '0.3.0' }) },
      storage: {
        local: {
          get: async keys => keys === null ? clone(window.__db) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in window.__db).map(key => [key, clone(window.__db[key])])),
          set: async values => {
            const changes = {};
            for (const [key, value] of Object.entries(values)) {
              changes[key] = { oldValue: clone(window.__db[key]), newValue: clone(value) };
              window.__db[key] = clone(value);
            }
            queueMicrotask(() => listeners.forEach(listener => listener(changes, 'local')));
          },
          remove: async keys => {
            const changes = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) { changes[key] = { oldValue: clone(window.__db[key]) }; delete window.__db[key]; }
            queueMicrotask(() => listeners.forEach(listener => listener(changes, 'local')));
          }
        },
        onChanged: { addListener: listener => listeners.push(listener) }
      }
    };
  });
  await page.goto('http://localhost:8765/manage/manage.html');
  await page.waitForFunction(() => document.querySelectorAll('.episode-name').length === 3);
  assert.deepEqual(await page.locator('.episode-name').allTextContents(), ['ep11', 'ep2', 'backlog']);
  const migrated = await page.evaluate(() => window.__db);
  assert.equal(migrated['videos:youtube:abcdefghijk'].pickedAt, undefined);
  assert.equal(migrated['markers:youtube:abcdefghijk'][0].updatedAt, '2026-09-20T00:00:00.000Z');
  assert.equal(migrated['order:2026-09-20'], undefined);
  assert.equal(migrated.settings.recentDays, undefined);
  assert.equal(await page.locator('[data-episode-id=""] .video').count(), 1);
  await page.locator('#search').fill('ep1');
  await page.waitForFunction(() => [...document.querySelectorAll('.episode-name')].some(node => node.textContent === 'ep1'));
  assert.equal(await page.locator('[data-episode-id="1"] .video').count(), 1);
  assert.equal(await page.locator('.drag-handle').count(), 0);
  await page.locator('#search').fill('');
  await page.getByRole('button', { name: '＋ 新增 Episode' }).click();
  await page.locator('#episodeName').fill('ep12');
  await page.locator('#episodeSave').click();
  await page.waitForFunction(() => document.querySelector('.episode-name')?.textContent === 'ep12');
  const ep12 = await page.evaluate(() => Library.episodes(window.__db).find(episode => episode.name === 'ep12').id);
  await page.locator(`[data-episode-id="${ep12}"]`).getByRole('button', { name: '加入影片', exact: true }).click();
  await page.locator('#assignSearch').fill('交通');
  await page.locator('#assignVideos input').check();
  await page.locator('#assignSave').click();
  await page.waitForFunction(id => document.querySelector(`[data-episode-id="${id}"] .video`), ep12);
  await page.locator(`[data-episode-id="${ep12}"] .marker-note`).first().fill('共用編輯');
  await page.locator(`[data-episode-id="${ep12}"] .marker-note`).first().press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-episode-id="11"] .marker-note')].some(input => input.value === '共用編輯'));
  // Cross-Episode dragging adds a relationship and keeps the source.
  await page.locator('[data-episode-id=""] .drag-handle').dragTo(page.locator(`[data-episode-id="${ep12}"] .episode-heading`));
  await page.waitForFunction(() => document.querySelectorAll('[data-episode-id=""] .video').length === 0);
  assert.equal(await page.locator(`[data-episode-id="${ep12}"] .video`).count(), 2);
  // Reordering uses the current persisted Episode membership.
  await page.locator(`[data-episode-id="${ep12}"] [data-video-key="tcc:456"] .drag-handle`).dragTo(page.locator(`[data-episode-id="${ep12}"] [data-video-key="youtube:abcdefghijk"]`), { targetPosition: { x: 20, y: 1 } });
  await page.waitForFunction(id => window.__db[`episode:${id}`].videoKeys[0] === 'tcc:456', ep12);
  // Undo membership removal preserves later marker content and ordering.
  await page.locator(`[data-episode-id="${ep12}"] [data-video-key="tcc:456"]`).getByRole('button', { name: '移除', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-episode-id=""] .video').length === 1);
  await page.locator('#toastAction').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-episode-id=""] .video').length === 0);
  await page.locator(`[data-episode-id="${ep12}"]`).getByRole('button', { name: '匯出', exact: true }).click();
  const exported = JSON.parse(await page.locator('#exportText').inputValue());
  assert.equal(exported.kind, 'episode');
  assert.equal(exported.episodes[0].name, 'ep12');
  assert.equal(exported.videos.length, 2);
  assert.equal(exported.videos[1].markers[0].note, '共用編輯');
  // Duplicate marker import still creates a new Episode membership.
  await page.locator('details').filter({ has: page.getByRole('heading', { name: '匯入', exact: true }) }).locator('summary').click();
  await page.locator('#importText').fill(JSON.stringify(exported));
  await page.locator('#importName').fill('ep13');
  await page.locator('#importPreview').click();
  await page.locator('#importApply').click();
  await page.waitForFunction(() => document.querySelector('.episode-name')?.textContent === 'ep13');
  assert.equal(await page.evaluate(() => window.__db['markers:youtube:abcdefghijk'].length), 2);
  // Delete and restore an Episode while preserving shared data.
  const ep13 = await page.evaluate(() => Library.episodes(window.__db).find(episode => episode.name === 'ep13').id);
  await page.locator(`[data-episode-id="${ep13}"]`).getByRole('button', { name: '刪除', exact: true }).click();
  await page.locator('#episodeSave').click();
  await page.waitForFunction(id => Boolean(window.__db[`episode:${id}`].deletedAt), ep13);
  await page.locator('#toastAction').click();
  await page.waitForFunction(id => !window.__db[`episode:${id}`].deletedAt, ep13);
  // Rename and duplicate validation.
  await page.locator(`[data-episode-id="${ep13}"]`).getByRole('button', { name: '改名', exact: true }).click();
  await page.locator('#episodeName').fill('ep12');
  await page.locator('#episodeSave').click();
  await page.waitForFunction(() => document.getElementById('episodeDialogError').textContent.includes('同名'));
  await page.locator('#episodeName').fill('ep14');
  await page.locator('#episodeSave').click();
  await page.waitForFunction(() => document.querySelector('.episode-name')?.textContent === 'ep14');
  await page.locator('#exportPanel > summary').click();
  await page.locator('details').filter({ has: page.getByRole('heading', { name: '匯入', exact: true }) }).locator('summary').click();
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'mpy-episodes-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'mpy-episodes-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  // A shared backend exercises actual Web Locks between two manage pages and popup.
  const sharedDb = {
    libraryVersion: 2, settings: { recentEpisodes: 0 }, markerMode: 'edit',
    'episode:concurrent': { id: 'concurrent', name: 'ep20', videoKeys: [], createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' },
    'videos:youtube:abcdefghijk': { site: 'youtube', title: 'shared video', pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk' },
    'markers:youtube:abcdefghijk': [{ id: 'shared', time: 5, note: 'original', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }],
    'videos:tcc:123': { site: 'tcc', title: 'other video', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=123' },
    'markers:tcc:123': [{ id: 'other', time: 5, note: 'other', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }]
  };
  const context = await browser.newContext();
  await context.route('http://localhost:8765/**', async route => {
    const file = root + new URL(route.request().url()).pathname;
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
  });
  await context.exposeBinding('__storageAccess', async (_, action, args) => {
    if (action === 'get') return args === null ? structuredClone(sharedDb) : Object.fromEntries((Array.isArray(args) ? args : [args]).filter(key => key in sharedDb).map(key => [key, structuredClone(sharedDb[key])]));
    const changes = {};
    if (action === 'set') for (const [key, value] of Object.entries(args)) {
      changes[key] = { oldValue: sharedDb[key], newValue: value }; sharedDb[key] = value;
    }
    if (action === 'remove') for (const key of Array.isArray(args) ? args : [args]) { changes[key] = { oldValue: sharedDb[key] }; delete sharedDb[key]; }
    for (const tab of context.pages()) tab.evaluate(changes => (window.__storageListeners || []).forEach(listener => listener(changes, 'local')), changes).catch(() => {});
  });
  await context.addInitScript(() => {
    window.__storageListeners = [];
    window.chrome = {
      runtime: { getManifest: () => ({ version: '0.3.0' }), getURL: path => 'http://localhost:8765/' + path },
      tabs: { query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk' }] },
      storage: { local: { get: keys => window.__storageAccess('get', keys), set: values => window.__storageAccess('set', values), remove: keys => window.__storageAccess('remove', keys) }, onChanged: { addListener: listener => window.__storageListeners.push(listener) } }
    };
    window.SiteAdapters = [{ matches: () => true, getState: async () => ({ ok: true, videoKey: 'youtube:abcdefghijk', site: 'youtube', pageTitle: 'shared video', pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', currentTime: 90, formattedTime: '00:01:30' }) }];
  });
  const first = await context.newPage();
  const second = await context.newPage();
  for (const tab of [first, second]) tab.on('pageerror', error => errors.push(error.message));
  await Promise.all([first.goto('http://localhost:8765/manage/manage.html'), second.goto('http://localhost:8765/manage/manage.html')]);
  await Promise.all([first.waitForSelector('.episode-name'), second.waitForSelector('.episode-name')]);
  await Promise.all([first.evaluate(() => addVideos('concurrent', ['youtube:abcdefghijk'])), second.evaluate(() => addVideos('concurrent', ['tcc:123']))]);
  assert.equal(sharedDb['episode:concurrent'].videoKeys.length, 2);
  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  await popup.goto('http://localhost:8765/popup/popup.html');
  await popup.waitForSelector('#markers .marker-edit');
  await popup.locator('#markers .marker-time').focus();
  await first.evaluate(() => changeMarker('youtube:abcdefghijk', 'shared', { note: 'managed edit', updatedAt: new Date().toISOString() }));
  await popup.locator('#markers .marker-time').fill('00:01:10');
  await popup.locator('#markers .marker-time').press('Tab');
  await popup.waitForFunction(() => document.querySelector('#markers .marker-edit:not(.marker-time)').value === 'managed edit');
  assert.equal(sharedDb['markers:youtube:abcdefghijk'][0].note, 'managed edit');
  assert.equal(sharedDb['markers:youtube:abcdefghijk'][0].time, 70);
  await popup.locator('#note').fill('new marker');
  await popup.locator('#save').click();
  await popup.waitForFunction(() => document.querySelectorAll('#markers .marker').length === 2);
  assert.equal(sharedDb['markers:youtube:abcdefghijk'].length, 2);
  await first.waitForFunction(() => document.querySelectorAll('[data-video-key="youtube:abcdefghijk"] .marker').length === 2);
  await context.close();
  assert.deepEqual(errors, []);
  console.log('PASS: browser migration, natural sorting, N limit, global search, create/rename, picker, shared edit, drag add/reorder, remove/undo, export/import, delete/undo, mobile overflow, concurrent manage pages and popup edit/save; no page errors');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
