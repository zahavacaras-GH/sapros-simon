/* ============================================================
   SAPROS MINIGAMES — shared audio state + UI control
   ------------------------------------------------------------
   window.SaprosAudio:
     .isMuted()                   → bool
     .volume()                    → 0..1
     .setMuted(bool)
     .setVolume(0..1)
     .effectiveGain()             → 0..1, accounts for mute
     .onChange(fn)                → unsubscribe()  — fn({muted, volume})
     .mount(parent, options)      → mounts the ♪ button
                                     options: { lang? }
   Persists to localStorage. Defaults to volume 0.7, unmuted.
   The same state is shared across the gallery and all three
   minigames so the player only has to set it once.
   ============================================================ */

(function (global) {
  'use strict';

  const KEY_MUTE = 'sapros-mg-mute';
  const KEY_VOL  = 'sapros-mg-volume';

  function readBool(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      return v === '1' || v === 'true';
    } catch (_) { return fallback; }
  }
  function readNum(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    } catch (_) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  }

  const state = {
    muted:  readBool(KEY_MUTE, false),
    volume: Math.max(0, Math.min(1, readNum(KEY_VOL, 0.7))),
  };
  const listeners = new Set();

  function emit() {
    const snap = { muted: state.muted, volume: state.volume };
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } });
  }

  function isMuted() { return state.muted; }
  function volume()  { return state.volume; }
  function effectiveGain() { return state.muted ? 0 : state.volume; }

  function setMuted(b) {
    const next = !!b;
    if (state.muted === next) return;
    state.muted = next;
    write(KEY_MUTE, next ? '1' : '0');
    emit();
  }
  function setVolume(v) {
    const next = Math.max(0, Math.min(1, Number(v) || 0));
    if (Math.abs(state.volume - next) < 0.001) return;
    state.volume = next;
    write(KEY_VOL, next.toFixed(3));
    // Setting volume above zero while muted unmutes — feels natural.
    if (next > 0 && state.muted) {
      state.muted = false;
      write(KEY_MUTE, '0');
    }
    emit();
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- UI control ----

  function t(key, fallback) {
    if (global.SaprosI18n && typeof global.SaprosI18n.t === 'function') {
      const v = global.SaprosI18n.t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  function mount(parent) {
    parent = parent || document.body;
    // If a control already exists in this parent, remove and rebuild
    // (e.g. on lang change we want updated aria-labels).
    parent.querySelectorAll('.sa-control').forEach(n => n.remove());

    const wrap = document.createElement('div');
    wrap.className = 'sa-control';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', t('common.audio', 'Audio'));

    const btn = document.createElement('button');
    btn.className = 'sa-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', t('common.toggle_audio', 'Toggle audio'));
    btn.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
    btn.textContent = '♪';

    const pop = document.createElement('div');
    pop.className = 'sa-popout';
    pop.setAttribute('role', 'group');
    pop.setAttribute('aria-label', t('common.volume', 'Volume'));

    const slider = document.createElement('input');
    slider.className = 'sa-slider';
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.value = String(Math.round(state.volume * 100));
    slider.setAttribute('aria-label', t('common.volume', 'Volume'));
    pop.appendChild(slider);

    wrap.appendChild(btn);
    wrap.appendChild(pop);
    parent.appendChild(wrap);

    function applyVisual() {
      btn.classList.toggle('is-muted', state.muted);
      btn.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
      slider.value = String(Math.round(state.volume * 100));
    }
    applyVisual();

    btn.addEventListener('click', () => {
      setMuted(!state.muted);
      // Tap also toggles the popout on touch (no hover state).
      if (!matchMedia('(hover: hover)').matches) {
        pop.classList.toggle('is-shown', !state.muted);
      }
    });

    slider.addEventListener('input', () => {
      setVolume(Number(slider.value) / 100);
    });

    // Subscribe to state so external changes (other minigames,
    // other tabs) keep this control in sync.
    const unsub = onChange(applyVisual);

    // Cross-tab sync via storage events.
    function onStorage(e) {
      if (e.key === KEY_MUTE) {
        state.muted = (e.newValue === '1' || e.newValue === 'true');
        applyVisual();
        emit();
      } else if (e.key === KEY_VOL) {
        const n = Number(e.newValue);
        if (Number.isFinite(n)) {
          state.volume = Math.max(0, Math.min(1, n));
          applyVisual();
          emit();
        }
      }
    }
    window.addEventListener('storage', onStorage);

    return function destroy() {
      unsub();
      window.removeEventListener('storage', onStorage);
      wrap.remove();
    };
  }

  global.SaprosAudio = {
    isMuted, volume, effectiveGain,
    setMuted, setVolume, onChange, mount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
