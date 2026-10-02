const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
const context = vm.createContext({ crypto: webcrypto, URL, navigator: {} });
for (const file of ['lib/markers.js', 'lib/video-key.js', 'lib/library.js']) {
  vm.runInContext(readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const library = vm.runInContext('Library', context);
const plain = value => JSON.parse(JSON.stringify(value));
const date = '2026-09-20T00:00:00.000Z';
const videoKey = 'youtube:abcdefghijk';
const marker = (id = 'marker-a', changes = {}) => ({ id, time: 5, note: '開場', createdAt: date, updatedAt: date, ...changes });
const episode = (id, name, keys = [videoKey]) => ({ id, name, videoKeys: keys, createdAt: date, updatedAt: date });
const seed = () => ({
  [`videos:${videoKey}`]: { title: '影片 A', pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', site: 'youtube' },
  [`markers:${videoKey}`]: [marker()],
  'episode:a': episode('a', 'ep1'),
  'episode:b': episode('b', 'ep11'),
  'episode:c': episode('c', 'ep2')
});
function exported(all = seed(), id = 'a', backup = false) {
  const parsed = library.parse(JSON.stringify(library.exportData(all, id, backup)));
  assert.equal(parsed.errors.length, 0);
  return parsed;
}

test('Episode names use descending natural order and reject duplicate/reserved names', () => {
  assert.deepEqual(plain(library.episodes(seed()).map(e => e.name)), ['ep11', 'ep2', 'ep1']);
  assert.throws(() => library.newEpisode(' EP1 ', seed()), /同名/);
  assert.throws(() => library.newEpisode(' BACKLOG ', {}), /保留/);
  assert.throws(() => library.newEpisode('   ', {}), /名稱/);
  assert.equal(library.newEpisode(' ep12 ', seed()).name, 'ep12');
});

test('Membership is shared, backlog excludes hidden Episodes, deleting all memberships returns video', () => {
  const all = seed();
  assert.equal(library.groupVideos(all, 'a')[0].markers[0].id, library.groupVideos(all, 'b')[0].markers[0].id);
  assert.equal(library.groupVideos(all, '').length, 0);
  all[`markers:${videoKey}`][0].note = 'edited';
  assert.equal(library.groupVideos(all, 'a')[0].markers[0].note, 'edited');
  for (const id of ['a', 'b', 'c']) all[`episode:${id}`].deletedAt = date;
  assert.equal(library.groupVideos(all, '').length, 1);
  all[`markers:${videoKey}`][0].deletedAt = date;
  assert.equal(library.groupVideos(all, '').length, 0);
});

test('Episode export keeps order, all live markers and original timestamps; empty Episodes round trip', () => {
  const all = seed();
  const second = 'tcc:123';
  all[`markers:${second}`] = [marker('second')];
  all['episode:a'].videoKeys = [second, videoKey];
  all[`markers:${videoKey}`].push(marker('deleted', { deletedAt: date }));
  const parsed = exported(all);
  assert.deepEqual(plain(parsed.videos.map(v => v.videoKey)), [second, videoKey]);
  assert.equal(parsed.videos[1].markers.length, 1);
  assert.equal(parsed.videos[1].markers[0].updatedAt, date);
  assert.equal(parsed.videos[0].pageUrl, '');
  all['episode:a'].videoKeys = [];
  const empty = exported(all);
  const plan = library.planImport(empty, {}, 'new', 'ep1');
  const updates = library.importUpdates(plan, {});
  assert.equal(library.episodes(updates).length, 1);
  assert.equal(library.episodes(updates)[0].videoKeys.length, 0);
});

test('Reimport is idempotent; edited same-ID markers produce explicit conflicts', () => {
  const all = seed();
  const parsed = exported(all);
  parsed.videos[0].markers[0].note = 'new content';
  const plan = library.planImport(parsed, all, 'b', '', 'local');
  assert.equal(plan.videos[0].added.length, 0);
  assert.equal(plan.videos[0].conflicts.length, 1);
  const local = library.importUpdates(plan, all);
  assert.equal(local[`markers:${videoKey}`][0].note, '開場');
  const incoming = library.importUpdates(library.planImport(parsed, all, 'b', '', 'incoming'), all);
  assert.equal(incoming[`markers:${videoKey}`][0].note, 'new content');
  assert.equal(incoming[`markers:${videoKey}`][0].id, 'marker-a');
  assert.equal(incoming[`markers:${videoKey}`].length, 1);
  const repeated = library.planImport(parsed, { ...all, ...incoming }, 'b', '');
  assert.equal(repeated.videos[0].duplicates, 1);
  assert.deepEqual(plain(repeated.episodes[0].videoKeys), [videoKey]);
});

test('Import duplicate markers can still add Episode membership; tombstones remain local by default', () => {
  const all = seed();
  all['episode:b'].videoKeys = [];
  const plan = library.planImport(exported(all), all, 'b', '');
  assert.equal(plan.videos[0].added.length, 0);
  assert.deepEqual(plain(library.importUpdates(plan, all)['episode:b'].videoKeys), [videoKey]);
  all[`markers:${videoKey}`][0].deletedAt = date;
  const tombstone = library.planImport(exported(seed()), all, '', '');
  assert.equal(tombstone.videos[0].conflicts.length, 1);
  assert.equal(library.importUpdates(tombstone, all)[`markers:${videoKey}`][0].deletedAt, date);
});

test('Legacy import combines repeated URLs and deduplicates content without resurrecting deletions', () => {
  const text = 'MPY Timecode Marker v1\n匯出摘要\n\n▶ A\nhttps://www.youtube.com/watch?v=abcdefghijk\n00:00:05 開場\n\n▶ A again\nhttps://www.youtube.com/watch?v=abcdefghijk\n00:00:08 第二段';
  const parsed = library.parse(text);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.videos.length, 1);
  const all = seed();
  all[`markers:${videoKey}`][0].deletedAt = date;
  const plan = library.planImport(parsed, all, '', '');
  assert.equal(plan.videos[0].duplicates, 1);
  assert.equal(plan.videos[0].added.length, 1);
  const updates = library.importUpdates(plan, all);
  assert.equal(updates[`markers:${videoKey}`].length, 2);
  assert.equal(updates[`markers:${videoKey}`][0].deletedAt, date);
  assert.ok(updates[`markers:${videoKey}`][1].id);
  assert.ok(library.parse('MPY Timecode Marker v1\n▶ Missing URL').errors.length);
});

test('Full backup restores shared membership, dates, tombstones, settings and metadata-only videos', () => {
  const all = seed();
  all[`markers:${videoKey}`].push(marker('deleted', { deletedAt: date }));
  all['videos:tcc:empty'] = { title: 'metadata only' };
  all.settings = { recentEpisodes: 3 };
  all.markerMode = 'edit';
  const parsed = exported(all, '', true);
  const restored = library.importUpdates(library.planImport(parsed, {}, '', ''), {});
  assert.equal(library.episodes(restored).length, 3);
  assert.equal(restored[`markers:${videoKey}`].length, 2);
  assert.equal(restored[`markers:${videoKey}`][1].deletedAt, date);
  assert.equal(restored['episode:a'].createdAt, date);
  assert.equal(restored['episode:a'].updatedAt, date);
  assert.equal(restored['videos:tcc:empty'].title, 'metadata only');
  assert.equal(restored.settings.recentEpisodes, 3);
  assert.equal(restored.markerMode, 'edit');
  const merged = library.importUpdates(library.planImport(parsed, restored, '', ''), restored);
  assert.equal(library.episodes(merged).length, 3);
  assert.equal(merged[`markers:${videoKey}`].length, 2);
});

test('Backup merges by ID, renames name collisions, keeps local extra members', () => {
  const parsed = exported(seed(), '', true);
  const all = { 'episode:other': episode('other', 'ep1', []), 'episode:b': episode('b', 'renamed', ['tcc:extra']) };
  const plan = library.planImport(parsed, all, '', '');
  assert.equal(plan.episodes.find(e => e.id === 'a').name, 'ep1 (2)');
  assert.equal(plan.episodes.find(e => e.id === 'b').name, 'renamed');
  assert.deepEqual(plain(plan.episodes.find(e => e.id === 'b').videoKeys), ['tcc:extra', videoKey]);
});

test('Invalid JSON, duplicate IDs, mismatched URLs and dangling members fail before writes', () => {
  assert.ok(library.parse('{bad').errors.length);
  for (const modify of [
    data => data.videos.push(data.videos[0]),
    data => data.videos[0].markers.push(data.videos[0].markers[0]),
    data => data.videos[0].markers[0].time = -1,
    data => data.videos[0].pageUrl = 'https://www.youtube.com/watch?v=other',
    data => data.episodes[0].videoKeys.push('tcc:missing'),
    data => data.episodes[0].name = 'backlog'
  ]) {
    const data = plain(library.exportData(seed(), 'a'));
    modify(data);
    const parsed = library.parse(JSON.stringify(data));
    assert.ok(parsed.errors.length);
    assert.throws(() => library.planImport(parsed, {}, '', ''));
  }
});
