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
      settings: { recentEpisodes: 2 }, markerMode: 'edit',
      'videos:youtube:abcdefghijk': { site: 'youtube', title: '交通議題影片 A', pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk' },
      'markers:youtube:abcdefghijk': [marker('a1', 68, '開場'), marker('a2', 320, '交通政策')],
      'videos:tcc:123': { site: 'tcc', title: '預算影片 B', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=123' },
      'markers:tcc:123': [marker('b1', 190, '預算說明')],
      'videos:tcc:456': { site: 'tcc', title: 'backlog 影片 C', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=456' },
      'markers:tcc:456': [marker('c1', 42, '待整理片段')],
      'episode:1': { id: '1', name: 'ep1', videoKeys: ['youtube:abcdefghijk'], createdAt: date, updatedAt: date },
      'episode:2': { id: '2', name: 'ep2', videoKeys: ['tcc:123'], createdAt: date, updatedAt: date },
      'episode:11': { id: '11', name: 'ep11', videoKeys: ['youtube:abcdefghijk'], createdAt: date, updatedAt: date }
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
  assert.deepEqual(await page.locator('#list .episode-name').allTextContents(), ['ep11:', 'ep2:', 'backlog:']);
  assert.equal(await page.locator('#libraryStats').textContent(), '(V:3,M:4,E:3)');
  assert.equal(await page.locator('.marker-preview').count(), await page.locator('.marker-editable').count());
  await page.evaluate(() => {
    window.__originalSeek = seekMarker;
    seekMarker = async (video, marker, play) => { window.__previewCall = { videoKey: video.videoKey, time: marker.time, play }; };
  });
  await page.getByRole('button', { name: '從此 Marker 播放', exact: true }).first().click();
  assert.deepEqual(await page.evaluate(() => window.__previewCall), { videoKey: 'youtube:abcdefghijk', time: 68, play: true });
  await page.evaluate(() => { seekMarker = window.__originalSeek; });
  await page.locator('#search').fill('ep2: t');
  assert.deepEqual(await page.locator('#list .episode-name').allTextContents(), ['ep2:']);
  assert.equal(await page.locator('#libraryStats').textContent(), '(V:3,M:4,E:3)');
  assert.equal(await page.locator('#list .video').count(), 1);
  await page.locator('#search').fill('ep11: y');
  assert.equal(await page.locator('#list .video').count(), 1);
  await page.locator('#search').fill('ep11: t');
  assert.equal(await page.locator('#list .video').count(), 0);
  await page.locator('#search').fill('');
  assert.equal(await page.locator('section[data-episode-id=""] .video').count(), 1);
  // Large libraries render a page of videos at a time.
  await page.evaluate(() => { listLimit = 1; renderList(); });
  assert.equal(await page.locator('#list .video').count(), 1);
  assert.equal(await page.locator('#listMore').textContent(), '顯示更多（還有 2 支影片、1 個 Episode）');
  await page.locator('#listMore').click();
  assert.equal(await page.locator('#list .video').count(), 3);
  assert.equal(await page.locator('#listMore').isVisible(), false);
  await page.evaluate(() => { listLimit = LIST_PAGE_SIZE; renderList(); });
  const videoGeometry = () => page.locator('section[data-episode-id="11"] .video').evaluate(node => {
    const rect = selector => { const box = node.querySelector(selector).getBoundingClientRect(); return { x: box.x, y: box.y, height: box.height, width: box.width }; };
    return { title: rect('.video-title'), time: rect('.marker-time'), marker: rect('.marker'), video: { height: node.getBoundingClientRect().height } };
  });
  const editGeometry = await videoGeometry();
  const libraryTop = await page.locator('#list').evaluate(node => node.getBoundingClientRect().top);
  const toolbarHeight = await page.locator('.marker-toolbar').evaluate(node => node.offsetHeight);
  for (const mode of ['cue', 'play']) {
    await page.locator(`#modes button[data-mode="${mode}"]`).click();
    await page.waitForFunction(() => document.getElementById('newEpisode').classList.contains('hidden') && !document.querySelector('.marker-note'));
    assert.equal(await page.locator('#newEpisode').isVisible(), false);
    assert.equal(await page.locator('.marker-preview').count(), 0);
    assert.equal(await page.locator('.marker-toolbar').evaluate(node => node.offsetHeight), toolbarHeight);
    assert.equal(await page.locator('#list').evaluate(node => node.getBoundingClientRect().top), libraryTop);
    assert.deepEqual(await videoGeometry(), editGeometry);
    assert.equal(await page.locator('.group-actions').getByRole('button', { name: '改名', exact: true }).count(), 0);
    assert.equal(await page.locator('.group-actions').getByRole('button', { name: '刪除', exact: true }).count(), 0);
    assert.equal(await page.locator('.group-actions').getByRole('button', { name: '匯出', exact: true }).count(), 0);
    assert.equal(await page.locator('section[data-episode-id=""]').count(), 0);
    await page.locator('#search').fill('待整理');
    assert.equal(await page.locator('section[data-episode-id=""] .video').count(), 1);
    await page.locator('#search').fill('');
    assert.equal(await page.locator('section[data-episode-id=""]').count(), 0);
  }
  await page.locator('#modes button[data-mode="edit"]').click();
  await page.waitForFunction(() => !document.getElementById('newEpisode').classList.contains('hidden') && document.querySelector('.marker-note'));
  assert.equal(await page.locator('section[data-episode-id=""] .video').count(), 1);
  assert.equal(await page.locator('.group-actions').getByRole('button', { name: '改名', exact: true }).count(), 2);
  assert.equal(await page.locator('.group-actions').getByRole('button', { name: '刪除', exact: true }).count(), 2);
  await page.locator('#search').fill('ep1');
  await page.waitForFunction(() => [...document.querySelectorAll('.episode-name')].some(node => node.textContent === 'ep1:'));
  assert.equal(await page.locator('section[data-episode-id="1"] .video').count(), 1);
  assert.equal(await page.locator('.drag-handle').count(), 0);
  await page.locator('#search').fill('');
  await page.getByRole('button', { name: '＋ 新增 Episode' }).click();
  await page.locator('#episodeName').fill('ep12');
  await page.locator('#episodeSave').click();
  await page.waitForFunction(() => document.querySelector('.episode-name')?.textContent === 'ep12:');
  const ep12 = await page.evaluate(() => Library.episodes(window.__db).find(episode => episode.name === 'ep12').id);
  assert.equal(await page.getByRole('button', { name: '加入影片', exact: true }).count(), 0);
  await page.locator('#search').fill('交通');
  await page.locator('.video-select').first().check();
  assert.equal(await page.locator('.video-select:checked').count(), 1);
  assert.equal(await page.locator('#selectionCount').textContent(), '已選 1 支影片');
  await page.locator('#assignSelected').click();
  assert.equal(await page.locator('.library-heading').evaluate(node => node.parentElement.open), true);
  await page.locator('#assignEpisode').selectOption(ep12);
  await page.locator('#assignSave').click();
  await page.waitForFunction(() => !document.getElementById("assignDialog").open);
  await page.waitForFunction(id => window.__db.settings.lastEpisodeId === id, ep12);
  await page.locator('#search').fill('');
  await page.waitForFunction(id => document.querySelector(`section[data-episode-id="${id}"] .video`), ep12);
  await page.locator(`section[data-episode-id="${ep12}"] .marker-note`).first().fill('共用編輯');
  await page.locator(`section[data-episode-id="${ep12}"] .marker-note`).first().press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('section[data-episode-id="11"] .marker-note')].some(input => input.value === '共用編輯'));
  // Backlog uses selection and the remembered Episode, without separate add buttons.
  assert.equal(await page.getByRole("button", { name: /^(全部加入 Episode|符合的影片加入 Episode)$/ }).count(), 0);
  await page.locator('section[data-episode-id=""] .video-select').check();
  await page.locator("#assignSelected").click();
  assert.equal(await page.locator('#assignEpisode').inputValue(), ep12);
  await page.locator('#assignSave').click();
  await page.waitForFunction(() => !document.getElementById("assignDialog").open);
  await page.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 0);
  assert.equal(await page.locator(`section[data-episode-id="${ep12}"] .video`).count(), 2);
  if (await page.locator("#clearSelection").isEnabled()) await page.locator("#clearSelection").click();
  await page.locator(`section[data-episode-id="${ep12}"] [data-video-key="tcc:456"] .video-select`).check();
  await page.locator("#removeSelected").click();
  await page.locator("#removeSave").click();
  await page.waitForFunction(() => !document.getElementById("removeDialog").open);
  await page.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 1);
  await page.locator('section[data-episode-id=""] .video-select').check();
  await page.locator("#assignSelected").click();
  assert.equal(await page.locator('#assignEpisode').inputValue(), ep12);
  await page.locator('[data-close-dialog="assignDialog"]').click();
  if (await page.locator("#clearSelection").isEnabled()) await page.locator("#clearSelection").click();
  assert.equal(await page.locator(".video .video-actions").count(), 0);
  assert.equal(await page.locator(".video").getByRole("button", { name: /^(加入 Episode|移除)$/ }).count(), 0);
  // Cross-Episode dragging adds a relationship and keeps the source.
  await page.locator('section[data-episode-id=""] .drag-handle').dragTo(page.locator(`section[data-episode-id="${ep12}"] .episode-heading`));
  await page.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 0);
  assert.equal(await page.locator(`section[data-episode-id="${ep12}"] .video`).count(), 2);
  // Reordering uses the current persisted Episode membership.
  await page.locator(`section[data-episode-id="${ep12}"] [data-video-key="tcc:456"] .drag-handle`).dragTo(page.locator(`section[data-episode-id="${ep12}"] [data-video-key="youtube:abcdefghijk"]`), { targetPosition: { x: 20, y: 1 } });
  await page.waitForFunction(id => window.__db[`episode:${id}`].videoKeys[0] === 'tcc:456', ep12);
  // Undo membership removal preserves later marker content and ordering.
  if (await page.locator("#clearSelection").isEnabled()) await page.locator("#clearSelection").click();
  await page.locator(`section[data-episode-id="${ep12}"] [data-video-key="tcc:456"] .video-select`).check();
  await page.locator("#removeSelected").click();
  await page.locator("#removeSave").click();
  await page.waitForFunction(() => !document.getElementById("removeDialog").open);
  await page.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 1);
  await page.locator('#toastAction').click();
  await page.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 0);
  await page.locator(`section[data-episode-id="${ep12}"]`).getByRole('button', { name: '匯出', exact: true }).click();
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
  await page.waitForFunction(() => document.querySelector('.episode-name')?.textContent === 'ep13:');
  assert.equal(await page.evaluate(() => window.__db['markers:youtube:abcdefghijk'].length), 2);
  // Delete and restore an Episode while preserving shared data.
  const ep13 = await page.evaluate(() => Library.episodes(window.__db).find(episode => episode.name === 'ep13').id);
  await page.locator(`section[data-episode-id="${ep13}"]`).getByRole('button', { name: '刪除', exact: true }).click();
  await page.locator('#episodeSave').click();
  await page.waitForFunction(id => Boolean(window.__db[`episode:${id}`].deletedAt), ep13);
  await page.locator('#toastAction').click();
  await page.waitForFunction(id => !window.__db[`episode:${id}`].deletedAt, ep13);
  // Rename and duplicate validation.
  await page.locator(`section[data-episode-id="${ep13}"]`).getByRole('button', { name: '改名', exact: true }).click();
  await page.locator('#episodeName').fill('ep12');
  await page.locator('#episodeSave').click();
  await page.waitForFunction(() => document.getElementById('episodeDialogError').textContent.includes('同名'));
  await page.locator('#episodeName').fill('ep14');
  await page.locator('#episodeSave').click();
  await page.waitForFunction(() => document.querySelector('.episode-name')?.textContent === 'ep14:');
  await page.locator('#exportPanel > summary').click();
  await page.locator('details').filter({ has: page.getByRole('heading', { name: '匯入', exact: true }) }).locator('summary').click();
  // Sticky controls stay visible even while scrolling to settings.
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.evaluate(() => { document.getElementById('list').style.minHeight = '1800px'; window.scrollTo(0, 400); });
  await page.waitForFunction(() => document.querySelector('.library-heading').getBoundingClientRect().top === document.querySelector('.marker-toolbar').getBoundingClientRect().bottom);
  const stickyCoverage = await page.locator('.library-heading').evaluate(node => {
    const heading = node.getBoundingClientRect(), card = node.parentElement.getBoundingClientRect();
    return { left: heading.left === card.left, right: heading.right === card.right, background: getComputedStyle(node).backgroundColor };
  });
  assert.deepEqual(stickyCoverage, { left: true, right: true, background: 'rgb(255, 255, 255)' });
  await page.evaluate(() => { document.getElementById('list').style.minHeight = ''; window.scrollTo(0, 0); });

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const toolbar = await page.locator('.marker-toolbar').boundingBox();
  const modes = await page.locator('#modes').boundingBox();
  assert.ok(toolbar.y >= 0 && toolbar.y < 4);
  assert.ok(modes.y >= 0 && modes.y + modes.height <= 1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'mpy-episodes-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'mpy-episodes-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const mobileModes = await page.locator('#modes').boundingBox();
  assert.ok(mobileModes.y >= 0 && mobileModes.y + mobileModes.height <= 844);
  // Spreadsheet paste follows the same preview/confirmation pipeline as JSON.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => { document.getElementById('importText').closest('details').open = true; });
  await page.locator('#importText').fill('url\ttimecode\tnote\ttitle\nhttps://live.tcc.gov.tw/watch?vdvno=999\t1:08\t試算表內容\t表格影片');
  await page.locator('#importTarget').selectOption(ep12);
  await page.locator('#importPreview').click();
  assert.equal(await page.locator('#importApply').isEnabled(), true);
  await page.locator('#importApply').click();
  await page.waitForFunction(() => window.__db['markers:tcc:999']?.[0]?.time === 68);
  assert.equal(await page.evaluate(() => window.__db['markers:tcc:999'][0].note), '試算表內容');
  assert.ok(await page.evaluate(id => window.__db[`episode:${id}`].videoKeys.includes('tcc:999'), ep12));
  await page.locator('#importText').fill('url,timecode,note\ninvalid,5,錯誤');
  await page.locator('#importPreview').click();
  assert.equal(await page.locator('#importApply').isEnabled(), false);
  // A shared backend exercises actual Web Locks between two manage pages and popup.
  const sharedDb = {
    settings: { recentEpisodes: 0 }, markerMode: 'edit',
    'episode:remembered': { id: 'remembered', name: 'ep21', videoKeys: [], createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' },
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
  // Remember selection across reloads, and fall back safely if the Episode is deleted.
  await first.evaluate(() => openAssign(['youtube:abcdefghijk']));
  await first.locator('#assignEpisode').selectOption('remembered');
  await first.waitForFunction(() => snapshot.settings?.lastEpisodeId === 'remembered');
  await first.locator('[data-close-dialog="assignDialog"]').click();
  await first.reload();
  await first.waitForSelector('.episode-name');
  await first.evaluate(() => openAssign(['tcc:123']));
  assert.equal(await first.locator('#assignEpisode').inputValue(), 'remembered');
  await first.locator('[data-close-dialog="assignDialog"]').click();
  await second.evaluate(() => updateEpisode('remembered', episode => ({ ...episode, deletedAt: new Date().toISOString() })));
  await first.waitForFunction(() => !document.querySelector('section[data-episode-id="remembered"]'));
  await first.evaluate(() => openAssign(['tcc:123']));
  assert.equal(await first.locator('#assignEpisode').inputValue(), '');
  assert.equal(await first.locator('#assignSave').isDisabled(), true);
  await first.locator('[data-close-dialog="assignDialog"]').click();
  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  await popup.goto('http://localhost:8765/popup/popup.html');
  await popup.waitForSelector('#markers .marker-edit');
  await popup.locator('#markers .marker-time').focus();
  await first.evaluate(() => changeMarker('youtube:abcdefghijk', 'shared', { note: 'managed edit', updatedAt: new Date().toISOString() }));
  await popup.locator('#markers .marker-time').fill('00:01:10');
  await popup.locator('#markers .marker-time').press('Tab');
  // Moving between fields keeps focus; the list refreshes once focus leaves it.
  await popup.waitForFunction(() => document.activeElement?.matches('#markers .marker-note'));
  await popup.locator('#note').focus();
  await popup.waitForFunction(() => document.querySelector('#markers .marker-edit:not(.marker-time)').value === 'managed edit');
  assert.equal(sharedDb['markers:youtube:abcdefghijk'][0].note, 'managed edit');
  assert.equal(sharedDb['markers:youtube:abcdefghijk'][0].time, 70);
  await popup.locator('#note').fill('new marker');
  await popup.locator('#save').click();
  await popup.waitForFunction(() => document.querySelectorAll('#markers .marker').length === 2);
  assert.equal(sharedDb['markers:youtube:abcdefghijk'].length, 2);
  // Shared edit fields: Enter ends the edit, and an empty Timecode restores the stored value.
  await popup.locator('#markers .marker-time').first().fill('');
  await popup.locator('#markers .marker-time').first().press('Enter');
  assert.equal(await popup.evaluate(() => document.activeElement?.matches('#markers input')), false);
  assert.equal(await popup.locator('#markers .marker-time').first().inputValue(), '00:01:10');
  assert.equal(sharedDb['markers:youtube:abcdefghijk'][0].time, 70);
  await first.waitForFunction(() => document.querySelectorAll('[data-video-key="youtube:abcdefghijk"] .marker').length === 2);
  // Episode queries use name prefixes rather than fuzzy Marker text.
  await first.evaluate(async () => {
    const date = new Date().toISOString();
    const updates = {};
    for (const number of [101, 102, 103, 1020]) {
      updates[`episode:search-${number}`] = { id: `search-${number}`, name: `ep${number}`, videoKeys: ['youtube:abcdefghijk'], createdAt: date, updatedAt: date };
    }
    await chrome.storage.local.set(updates);
  });
  await first.waitForSelector('section[data-episode-id="search-102"]');
  await first.locator('#search').fill('ep102');
  assert.deepEqual(await first.locator('#list .episode-name').allTextContents(), ['ep1020:', 'ep102:']);
  await first.locator('#search').fill('ep102:');
  assert.deepEqual(await first.locator('#list .episode-name').allTextContents(), ['ep102:']);
  await first.locator('#search').fill('ep102: 後续');
  assert.equal(await first.locator('.video').count(), 0);
  await first.locator('#search').fill('ep10');
  assert.deepEqual(await first.locator('#list .episode-name').allTextContents(), ['ep1020:', 'ep103:', 'ep102:', 'ep101:']);
  await first.locator('#search').fill('');
  // Filtered backlog batches include only matching videos; changing search clears selection.
  await first.evaluate(async () => {
    const date = new Date().toISOString();
    await chrome.storage.local.set({
      'videos:tcc:900': { site: 'tcc', title: '待加入甲', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=900' },
      'markers:tcc:900': [{ id: 'batch-a', time: 1, note: '甲', createdAt: date, updatedAt: date }],
      'videos:tcc:901': { site: 'tcc', title: '待加入乙', pageUrl: 'https://live.tcc.gov.tw/watch?vdvno=901' },
      'markers:tcc:901': [{ id: 'batch-b', time: 2, note: '乙', createdAt: date, updatedAt: date }]
    });
  });
  await first.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 2);
  await first.locator('#search').fill('待加入甲');
  await first.locator('.video-select').check();
  await first.locator('#search').fill('待加入');
  assert.equal(await first.locator('#selectionCount').textContent(), '已選 0 支影片');
  await first.locator('#selectAllVideos').click();
  assert.equal(await first.locator('#selectionCount').textContent(), '已選 2 支影片');
  await first.locator('#clearSelection').click();
  await first.locator('#search').fill('待加入甲');
  await first.locator('section[data-episode-id=""] .video-select').check();
  await first.locator("#assignSelected").click();
  assert.equal(await first.locator('#assignVideos .assign-video').count(), 1);
  await first.locator('#assignEpisode').selectOption('concurrent');
  await first.locator('#assignSave').click();
  await first.waitForFunction(() => !document.getElementById('assignDialog').open);
  assert.ok(sharedDb['episode:concurrent'].videoKeys.includes('tcc:900'));
  assert.equal(sharedDb['episode:concurrent'].videoKeys.includes('tcc:901'), false);
  await first.locator('#search').fill('');
  await first.locator('section[data-episode-id=""] .video-select').check();
  await first.locator("#assignSelected").click();
  assert.equal(await first.locator('#assignEpisode').inputValue(), 'concurrent');
  await first.locator('#assignSave').click();
  await first.waitForFunction(() => !document.getElementById('assignDialog').open);
  assert.ok(sharedDb['episode:concurrent'].videoKeys.includes('tcc:901'));
  // Batch removal changes only the chosen Episode, with one undo for the whole batch.
  const beforeRemoval = [...sharedDb['episode:concurrent'].videoKeys];
  const otherEpisodeMembers = [...sharedDb['episode:search-101'].videoKeys];
  await first.locator('#search').fill('待加入');
  await first.locator('#selectAllVideos').click();
  await first.locator('#removeSelected').click();
  assert.equal(await first.locator('#removeGroups .remove-group').count(), 1);
  assert.equal(await first.locator('#removeDialog select').count(), 0);
  await first.locator('#removeSave').click();
  await first.waitForFunction(() => !document.getElementById('removeDialog').open);
  assert.equal(sharedDb['episode:concurrent'].videoKeys.includes('tcc:900'), false);
  assert.equal(sharedDb['episode:concurrent'].videoKeys.includes('tcc:901'), false);
  assert.deepEqual(sharedDb['episode:search-101'].videoKeys, otherEpisodeMembers);
  await first.waitForFunction(() => document.querySelectorAll('section[data-episode-id=""] .video').length === 2);
  await first.locator('#selectAllVideos').click();
  assert.equal(await first.locator('#removeSelected').isDisabled(), true);
  // Preserve edits and the ordering of surviving members made after removal.
  await second.evaluate(async () => {
    await updateEpisode('concurrent', episode => ({ ...episode, videoKeys: [...episode.videoKeys].reverse() }));
    await changeMarker('tcc:900', 'batch-a', { note: 'later edit', updatedAt: new Date().toISOString() });
  });
  const survivingOrder = [...sharedDb['episode:concurrent'].videoKeys];
  await first.locator('#toastAction').click();
  await first.waitForFunction(() => snapshot['episode:concurrent']?.videoKeys.length === 4);
  const restoredOrder = sharedDb['episode:concurrent'].videoKeys;
  assert.deepEqual(restoredOrder.filter(key => !['tcc:900', 'tcc:901'].includes(key)), survivingOrder);
  assert.deepEqual([...restoredOrder].sort(), [...beforeRemoval].sort());
  assert.equal(sharedDb['markers:tcc:900'][0].note, 'later edit');
  // Identical videos in different Episodes have independent selection and removal.
  await first.locator('#search').fill('ep102:');
  assert.deepEqual(await first.locator('#list .episode-name').allTextContents(), ['ep102:']);
  await first.locator('#search').fill('ep102: 後续');
  assert.equal(await first.locator('.video').count(), 0);
  await first.locator('#search').fill('ep10');
  await first.locator('section[data-episode-id="search-101"] .video-select').check();
  assert.equal(await first.locator('section[data-episode-id="search-102"] .video-select').isChecked(), false);
  await first.locator('section[data-episode-id="search-102"] .video-select').check();
  assert.equal(await first.locator('#selectionCount').textContent(), '已選 1 支影片（2 個位置）');
  await first.locator('#removeSelected').click();
  assert.equal(await first.locator('#removeGroups .remove-group').count(), 2);
  assert.equal(await first.locator('#removeDialog select').count(), 0);
  await first.locator('#removeSave').click();
  await first.waitForFunction(() => !document.getElementById('removeDialog').open);
  assert.equal(sharedDb['episode:search-101'].videoKeys.length, 0);
  assert.equal(sharedDb['episode:search-102'].videoKeys.length, 0);
  assert.deepEqual(sharedDb['episode:search-103'].videoKeys, ['youtube:abcdefghijk']);
  assert.deepEqual(sharedDb['episode:search-1020'].videoKeys, ['youtube:abcdefghijk']);
  assert.ok(sharedDb['episode:concurrent'].videoKeys.includes('youtube:abcdefghijk'));
  assert.equal(sharedDb['markers:youtube:abcdefghijk'].length, 2);
  await first.locator('#toastAction').click();
  await first.waitForFunction(() => snapshot['episode:search-101']?.videoKeys.length === 1 && snapshot['episode:search-102']?.videoKeys.length === 1);
  assert.deepEqual(sharedDb['episode:search-101'].videoKeys, ['youtube:abcdefghijk']);
  assert.deepEqual(sharedDb['episode:search-102'].videoKeys, ['youtube:abcdefghijk']);
  await context.close();
  assert.deepEqual(errors, []);
  console.log('PASS: natural sorting, N limit, global search, create/rename, main-list selection, backlog batch, remembered Episode, sticky controls, shared edit, drag add/reorder, selection remove/undo, export/import, delete/undo, mobile overflow, concurrent manage pages and popup edit/save, paged list, library stats; no page errors');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
