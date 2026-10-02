// Format readers normalize external data before Library previews and merges it.
// Add readers here without changing membership or storage logic.
const ImportFormats = (() => {
  function readTable(text, delimiter) {
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === delimiter || char === '\n' || char === '\r') {
        row.push(field); field = ''; closed = false;
        if (char !== delimiter) {
          rows.push(row); row = [];
          if (char === '\r' && text[i + 1] === '\n') i++;
        }
      } else if (char === '"' && !field && !closed) quoted = true;
      else {
        if (closed || char === '"') throw new Error('表格引號格式不正確');
        field += char;
      }
    }
    if (quoted) throw new Error('表格引號尚未結束');
    row.push(field); rows.push(row);
    return rows.filter(values => values.some(value => value.trim()));
  }
  function parseTable(text) {
    const firstLine = text.split(/\r?\n/, 1)[0];
    const rows = readTable(text, firstLine.includes('\t') ? '\t' : ',');
    const aliases = { url: 'url', 網址: 'url', timecode: 'timecode', 時間: 'timecode', note: 'note', description: 'note', 說明: 'note', title: 'title', 影片標題: 'title' };
    const headers = (rows.shift() || []).map(value => aliases[value.trim().toLowerCase()]);
    if (headers.some(value => !value) || new Set(headers).size !== headers.length || !['url', 'timecode', 'note'].every(value => headers.includes(value))) {
      throw new Error('表格第一列需包含 url、timecode、note，可選填 title；支援 CSV 或 Tab 分隔文字');
    }
    const videos = new Map(), errors = [];
    rows.forEach((values, index) => {
      const fail = message => errors.push(`第 ${index + 2} 筆：${message}`);
      if (values.length !== headers.length) { fail('欄位數量與標題列不一致'); return; }
      const data = Object.fromEntries(headers.map((name, i) => [name, values[i].trim()]));
      const key = videoKeyFromUrl(data.url);
      if (!key) { fail('不支援的影片網址'); return; }
      const time = data.timecode ? parseTimecode(data.timecode) : null;
      if (time === null || !Number.isFinite(time) || time < 0) { fail('Timecode 不正確'); return; }
      if (!videos.has(key)) videos.set(key, { videoKey: key, pageUrl: data.url, title: data.title || key,
        site: key.startsWith('youtube:') ? 'youtube' : 'tcc', markers: [] });
      const video = videos.get(key);
      if (data.title && video.title === key) video.title = data.title;
      video.markers.push({ time, note: data.note || 'Marker' });
    });
    if (!rows.length) errors.push('沒有可匯入的影片或 Marker');
    return { kind: 'table', videos: [...videos.values()], episodes: [], errors };
  }
  const readers = [
    { matches: text => /^[\[{]/.test(text.trimStart()), read: (text, validateJson) => validateJson(JSON.parse(text)) },
    { matches: () => true, read: parseTable }
  ];
  function parse(text, validateJson) {
    try {
      const input = text.replace(/^\uFEFF/, '').replace(/^[\r\n]+/, '');
      if (!input.trim()) throw new Error('請貼上 v2 JSON 或 CSV／TSV 表格資料');
      return readers.find(reader => reader.matches(input)).read(input, validateJson);
    } catch (error) { return { videos: [], episodes: [], errors: [error.message] }; }
  }
  return { parse };
})();
