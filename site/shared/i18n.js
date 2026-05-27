/* ============================================================
   SAPROS MINIGAMES — i18n loader
   Tiny dependency-free helper. Loads /site/lang/{lang}.json,
   exposes t('minigames.lockpick.prompt'), and sets <html lang/dir>.
   Designed to interop with Sapros's own engine: if Sapros has
   already loaded its language pack on window.SAPROS_LANG, we use
   that instead of re-fetching.
   ============================================================ */

(function (global) {
  'use strict';

  const SUPPORTED = ['en', 'he', 'zh', 'fr', 'es'];
  const RTL = new Set(['he']);

  let _lang = 'en';
  let _dict = {};
  const _cache = new Map();

  function pathBase() {
    // When loaded from site/shared/i18n.js, lang lives at ../lang/.
    // When merged into Sapros, the host can override via setLangPath().
    return global.__SAPROS_MG_LANG_PATH__ || '/site/lang/';
  }

  function setLangPath(p) {
    global.__SAPROS_MG_LANG_PATH__ = p.endsWith('/') ? p : p + '/';
  }

  function resolve(key) {
    // 'minigames.lockpick.prompt' → walk the dict.
    const parts = key.split('.');
    let node = _dict;
    for (let i = 0; i < parts.length; i++) {
      if (node == null || typeof node !== 'object') return null;
      node = node[parts[i]];
    }
    return (typeof node === 'string') ? node : null;
  }

  function t(key, fallback) {
    const v = resolve(key);
    if (v != null) return v;
    return (fallback != null) ? fallback : key;
  }

  async function load(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'en';
    if (_cache.has(lang)) {
      _dict = _cache.get(lang);
    } else {
      // Allow host (Sapros) to inject the dict directly.
      const injected = (global.SAPROS_LANG && global.SAPROS_LANG[lang]) || null;
      if (injected && injected.minigames) {
        _dict = injected;
      } else {
        const res = await fetch(pathBase() + lang + '.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error('i18n: failed to load ' + lang);
        _dict = await res.json();
      }
      _cache.set(lang, _dict);
    }
    _lang = lang;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    }
    return _dict;
  }

  function getLang() { return _lang; }
  function isRTL()   { return RTL.has(_lang); }

  global.SaprosI18n = { load, t, getLang, isRTL, setLangPath, SUPPORTED };
})(typeof window !== 'undefined' ? window : globalThis);
