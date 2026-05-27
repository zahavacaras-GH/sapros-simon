/* ============================================================
   SAPROS MINIGAMES — portrait-only gate
   ------------------------------------------------------------
   window.SaprosRotate.mount(parent?)
     Builds a .rotate-overlay element inside `parent` (defaults
     to document.body). The overlay is hidden by CSS and only
     becomes visible at small landscape viewports on touch
     devices. Idempotent — calling again removes the old one
     and remounts (useful after a language change).
   ============================================================ */

(function (global) {
  'use strict';

  function t(key, fallback) {
    if (global.SaprosI18n && typeof global.SaprosI18n.t === 'function') {
      const v = global.SaprosI18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function iconSVG() {
    // Left: phone in landscape (dashed, low opacity — the "wrong"
    // state). Right: phone in portrait (solid — the "target").
    // Curved arrow between them. The whole group wears the
    // rotate-pulse animation so it gently rocks back and forth.
    return '' +
      '<svg viewBox="0 0 110 70" width="96" height="60" fill="none" ' +
        'stroke="currentColor" stroke-width="1.5" ' +
        'stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true">' +
        '<g class="rotate-icon-anim">' +
          // Landscape phone (wrong orientation)
          '<rect x="6" y="18" width="50" height="32" rx="4" ' +
            'stroke-dasharray="3 3" opacity="0.45" />' +
          '<circle cx="12" cy="34" r="0.9" fill="currentColor" opacity="0.55" />' +
          // Portrait phone (target orientation)
          '<rect x="78" y="8" width="22" height="54" rx="3" />' +
          '<line x1="85" y1="56" x2="93" y2="56" />' +
          // Curve + arrow from one to the other
          '<path d="M 56 14 Q 70 4 80 16" stroke-dasharray="2 3" />' +
          '<polyline points="80,16 74,12 76,20" />' +
        '</g>' +
      '</svg>';
  }

  function mount(parent) {
    parent = parent || document.body;
    parent.querySelectorAll('.rotate-overlay').forEach(n => n.remove());

    const div = document.createElement('div');
    div.className = 'rotate-overlay';
    div.setAttribute('role', 'alertdialog');
    div.setAttribute('aria-modal', 'true');
    div.setAttribute('aria-labelledby', 'sapros-rotate-title');
    div.innerHTML =
      '<div class="rotate-overlay-inner">' +
        '<div class="rotate-icon">' + iconSVG() + '</div>' +
        '<h2 class="rotate-overlay-title" id="sapros-rotate-title">' +
          escapeHtml(t('common.rotate_title', 'Rotate your phone')) +
        '</h2>' +
        '<p class="rotate-overlay-subtitle">' +
          escapeHtml(t('common.rotate_hint', 'This scene plays in portrait.')) +
        '</p>' +
      '</div>';
    parent.appendChild(div);

    // Re-mount when the language changes so the text updates.
    // (SaprosI18n.load is called every time the user picks a lang
    // in the gallery; we can't subscribe, but we can re-mount on
    // demand from the caller.)
  }

  global.SaprosRotate = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
