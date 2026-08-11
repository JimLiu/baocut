// BaoCut Subtitle Studio — shared subtitle font catalog.
// Keeps the Web Studio picker and renderer aligned with the Mac App's curated
// families while exposing browser-authorized system fonts when available.
(() => {
  const LEGACY = Object.freeze({
    system: { family: 'Noto Sans SC', label: '系统黑体' },
    montserrat: { family: 'Montserrat', label: 'Montserrat' },
    bebas: { family: 'Bebas Neue', label: 'Bebas Neue' },
    lexend: { family: 'Lexend Deca', label: 'Lexend Deca' },
    serif: { family: 'Source Serif 4', label: '衬线 Serif' },
  });

  // Exact twin of SampleData.fontLibrary in the Mac App. The source describes
  // where the App gets the family; every row remains a first-class built-in
  // choice in Studio.
  const BUILT_INS = Object.freeze([
    { family: 'Montserrat', stack: '"Montserrat", "Source Sans 3", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Lexend Deca', stack: '"Lexend Deca", "Source Sans 3", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Alata', stack: '"Alata", "Source Sans 3", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Bebas Neue', stack: '"Bebas Neue", "Arial Narrow", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Archivo Black', stack: '"Archivo Black", "Arial Black", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Paytone One', stack: '"Paytone One", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Carter One', stack: '"Carter One", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Fredoka One', stack: '"Fredoka One", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Bangers', stack: '"Bangers", "Noto Sans SC", sans-serif', source: 'google' },
    { family: 'Permanent Marker', stack: '"Permanent Marker", "Noto Sans SC", cursive', source: 'google' },
    { family: 'Dancing Script', stack: '"Dancing Script", "Noto Sans SC", cursive', source: 'google' },
    { family: 'Press Start 2P', stack: '"Press Start 2P", "Noto Sans SC", monospace', source: 'google' },
    { family: 'Impact', stack: 'Impact, "Arial Black", "Noto Sans SC", sans-serif', source: 'system' },
    { family: 'Comic Sans MS', stack: '"Comic Sans MS", "Comic Sans", "Noto Sans SC", cursive', source: 'system' },
    { family: 'Courier New', stack: '"Courier New", Courier, "Noto Sans SC", monospace', source: 'system' },
    { family: 'Source Sans 3', stack: '"Source Sans 3", "Noto Sans SC", sans-serif', source: 'bundled' },
    { family: 'Source Serif 4', stack: '"Source Serif 4", "Songti SC", "Noto Sans SC", serif', source: 'bundled' },
    { family: 'Source Code Pro', stack: '"Source Code Pro", "Noto Sans SC", monospace', source: 'bundled' },
  ]);

  const familyValue = (value) => {
    const raw = value && typeof value === 'object' ? value.fontFamily : value;
    return String(raw || '').trim();
  };
  const familyKey = (value) => familyValue(value).toLocaleLowerCase('en-US');
  const uniqueSorted = (families) => {
    const seen = new Set();
    return (families || [])
      .map(familyValue)
      .filter((family) => {
        const key = familyKey(family);
        return key && !seen.has(key) && !!seen.add(key);
      })
      .sort((left, right) => left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: 'base',
      }));
  };
  const byKey = new Map(BUILT_INS.map((font) => [familyKey(font.family), font]));
  const claimedKeys = new Set(BUILT_INS.map((font) => familyKey(font.family)));
  const quoteFamily = (family) => '"' + family.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  function canonicalFamily(value) {
    const raw = familyValue(value);
    const legacy = LEGACY[familyKey(raw)];
    return legacy ? legacy.family : raw;
  }

  function displayName(value) {
    const raw = familyValue(value);
    const legacy = LEGACY[familyKey(raw)];
    return legacy ? legacy.label : (raw || LEGACY.system.label);
  }

  function stackFor(value) {
    const family = canonicalFamily(value) || LEGACY.system.family;
    const font = byKey.get(familyKey(family));
    if (font) return font.stack;
    if (family === LEGACY.system.family) {
      return '"Noto Sans SC", -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
    }
    return quoteFamily(family) + ', "Noto Sans SC", "PingFang SC", sans-serif';
  }

  function sameFamily(left, right) {
    return familyKey(canonicalFamily(left)) === familyKey(canonicalFamily(right));
  }

  let grantedSystemFamilies = [];

  function systemFamilies() {
    return grantedSystemFamilies.slice();
  }

  async function requestSystemFonts() {
    if (typeof window.queryLocalFonts !== 'function') {
      return { status: 'unsupported', families: systemFamilies() };
    }
    try {
      // The specification requires transient user activation; callers invoke
      // this directly from the picker's button click.
      const fonts = await window.queryLocalFonts();
      grantedSystemFamilies = uniqueSorted(fonts.map((font) => font && font.family))
        .filter((family) => !claimedKeys.has(familyKey(family)));
      return { status: 'ready', families: systemFamilies() };
    } catch (error) {
      const errorName = error && error.name ? String(error.name) : 'Error';
      const denied = errorName === 'NotAllowedError' || errorName === 'SecurityError';
      return {
        status: denied ? 'denied' : 'error',
        families: systemFamilies(),
        errorName,
      };
    }
  }

  const legacyStacks = {};
  Object.entries(LEGACY).forEach(([key, value]) => { legacyStacks[key] = stackFor(value.family); });
  BUILT_INS.forEach((font) => { legacyStacks[font.family] = font.stack; });

  window.BCS_FONTS = Object.freeze(legacyStacks);
  window.BCS_FONT_CATALOG = Object.freeze({
    builtIns: () => BUILT_INS.map((font) => ({ ...font })),
    systemFamilies,
    requestSystemFonts,
    canonicalFamily,
    displayName,
    stackFor,
    sameFamily,
    uniqueSorted,
  });
})();
