/* 字幕属性的下次使用偏好（product-design §5.9）。只存选项，不存文字、语言或 cue 覆盖。 */
(function () {
  const KEY = 'bc-subtitle-prefs-v1';
  const ROOT_KEYS = ['punct', 'displayTiming', 'gap'];
  const TRACK_KEYS = ['font', 'size', 'color', 'bold', 'italic', 'align', 'upper', 'lh', 'spacing',
    'outline', 'outlineW', 'outlineColor', 'shadow', 'shDist', 'shBlur', 'shAngle', 'shColor',
    'plate', 'bg', 'opacity', 'corners', 'y', 'valign', 'x', 'width'];
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const valid = (k, v) => {
    if (k === 'displayTiming') return object(v) && ['leadIn', 'tail'].every(n => Number.isFinite(v[n]) && v[n] >= 0 && v[n] <= (n === 'tail' ? 3 : 2));
    if (['punct', 'bold', 'italic', 'outline', 'shadow'].includes(k)) return typeof v === 'boolean';
    if (['font', 'color', 'align', 'upper', 'outlineColor', 'shColor', 'plate', 'bg'].includes(k)) return typeof v === 'string';
    if (k === 'valign') return ['top', 'center', 'bottom'].includes(v);
    return Number.isFinite(v) && (['x', 'y', 'width', 'gap'].includes(k) ? v >= 0 && v <= (k === 'gap' ? 40 : 100) : true);
  };
  const pick = (v, keys) => Object.fromEntries(keys.filter(k => object(v) && valid(k, v[k])).map(k => [k, v[k]]));
  function clean(p) {
    return {root: pick(p && p.root, ROOT_KEYS), roles: {
      source: pick(p && p.roles && p.roles.source, TRACK_KEYS),
      translation: pick(p && p.roles && p.roles.translation, TRACK_KEYS),
    }};
  }
  function load(storage, key) {
    try { return clean(JSON.parse(storage.getItem(key))); } catch { return clean(null); }
  }
  function apply(doc, prefs) {
    const p = clean(prefs);
    return Object.assign({punct: true, displayTiming: {leadIn: 0.5, tail: 1}, gap: 6}, doc, p.root, {
      tracks: (doc.tracks || []).map(t => Object.assign({x: 50, width: 80}, t, p.roles[t.role === 'source' ? 'source' : 'translation'])),
    });
  }
  function remember(prefs, before, after) {
    const p = clean(prefs);
    const changed = (a, b, keys) => pick(Object.fromEntries(keys.filter(k => JSON.stringify(a && a[k]) !== JSON.stringify(b && b[k])).map(k => [k, b && b[k]])), keys);
    Object.assign(p.root, changed(before, after, ROOT_KEYS));
    (after.tracks || []).forEach(t => {
      const old = (before.tracks || []).find(b => b.id === t.id);
      if (old) Object.assign(p.roles[t.role === 'source' ? 'source' : 'translation'], changed(old, t, TRACK_KEYS));
    });
    return p;
  }
  const SUFFIXES = 'app ai avi bin c cc cn com conf cpp css csv dev doc docx edu gif go gov h hpp html io java jpeg jpg js json log m md mov mp3 mp4 net org pdf php plist png py rb rs sh sql svg swift toml ts txt uk us vtt wav xml yaml yml zip'.split(' ');
  const ABBREVIATIONS = 'mr mrs ms dr prof st sr jr rev hon fr gen gov sen rep col lt sgt capt vs etc inc ltd corp dept vol fig'.split(' ');
  const tokenChar = c => !!c && /^[a-z0-9._@/:~%+?=&()[\]{}\\-]$/i.test(c);
  function keepPeriod(s, i) {
    const next = s[i + 1], previous = s[i - 1];
    const cjk = c => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c || '');
    if (cjk(previous) || cjk(next)) {
      const parts = ((s.slice(i + 1).match(/^[a-z0-9.]+/i) || [''])[0]).toLowerCase().split('.').filter(Boolean);
      return cjk(previous) && (SUFFIXES.includes(parts[0]) || SUFFIXES.includes(parts.at(-1)));
    }
    let left = i, right = i + 1;
    while (left && tokenChar(s[left - 1])) left--;
    while (right < s.length && tokenChar(s[right])) right++;
    const token = s.slice(left, right).toLowerCase();
    const pieces = token.split('.').filter(Boolean);
    const suffix = parts => parts.length >= 2 && SUFFIXES.includes(parts.at(-1));
    if (!tokenChar(next) && suffix(s.slice(left, i).toLowerCase().split('.').filter(Boolean))) return false;
    if (/[a-z0-9]/i.test(previous || '') && /[a-z0-9]/i.test(next || '')) return true;
    if (i === left && /[a-z0-9]/i.test(next || '') && (!left || /\s/.test(s[left - 1]))) return true;
    if (['://', '@', '/', '\\', '=', '{', '}', '[', ']', '_', '::', '->'].some(k => token.includes(k)) || (token.includes('(') && token.includes(')'))) return true;
    if (/[0-9]/.test(token) || suffix(pieces) || (pieces.length >= 2 && pieces.every(p => /^[a-z]$/.test(p)))) return true;
    return ABBREVIATIONS.includes((s.slice(0, i).match(/[a-z]+$/i) || [''])[0].toLowerCase());
  }
  function displayText(text, enabled) {
    if (!enabled) return text;
    const s = String(text || '');
    let output = '', pending = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\n' || c === '\r') { output += c; pending = false; continue; }
      const number = /[0-9]/.test(s[i - 1] || '') && /[0-9]/.test(s[i + 1] || '');
      const ellipsis = c === '.' && (s.slice(Math.max(0, i - 2), i + 3).match(/\.{3,}/));
      if ('，,。．.'.includes(c) && !number && !(c === '.' && (ellipsis || keepPeriod(s, i)))) {
        output = output.replace(/[^\S\r\n]+$/, ''); pending = true; continue;
      }
      if (/\s/.test(c)) { if (!pending) output += c; continue; }
      const closing = ')]}）］｝】〕」』〉》”’'.includes(c) || ('\"\''.includes(c) && (s.slice(0, i).split(c).length - 1) % 2 === 1);
      if (pending && closing) { output += c; continue; }
      if (pending && output) output += ' ';
      output += c; pending = false;
    }
    return output;
  }
  function cueAt(cues, time, timing) {
    const lead = timing ? timing.leadIn : 0.5, tail = timing ? timing.tail : 1;
    return (cues || []).find(c => time >= c.start && time < c.end)
      || (cues || []).find(c => time >= c.start - lead && time < c.end + tail) || null;
  }
  function withGap(doc, gap) {
    const src = window.BC_SUB.source(doc), tr = window.BC_SUB.translations(doc)[0];
    const delta = (gap - (doc.gap == null ? 6 : doc.gap)) / 540 * 100;
    return {gap, tracks: doc.tracks.map(t => t !== tr || !src ? t : Object.assign({}, t, {
      y: Math.max(0, Math.min(100, t.y + (t.y <= src.y ? -delta : delta))),
    }))};
  }
  window.BC_SUB_PREFS = {KEY, clean, load, apply, remember, displayText, cueAt, withGap};
})();
