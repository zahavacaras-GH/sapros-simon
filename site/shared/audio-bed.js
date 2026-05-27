/* ============================================================
   SAPROS MINIGAMES — shared audio bed helper
   ------------------------------------------------------------
   A tiny wrapper that any minigame can use to play a looping
   ambient track and have it AUTOMATICALLY respect the player's
   main-game mute / volume setting — live, with no extra code.

   Why this exists:
     The first two minigames (Lockpick, Sweep) duplicated audio
     plumbing inline. Lockpick wired up SaprosAudio correctly;
     Sweep hardcoded a volume and ignored mute. To stop that
     class of bug, all future minigame audio beds should be
     created via this helper.

   ============================================================
   Public API
   ============================================================

     const bed = SaprosAudioBed.create({
       url:     'audio/m_suspense.mp3', // path relative to page
       base:    0.22,                    // 0..1 local ceiling
       loop:    true,                    // default true
       fadeIn:  1600,                    // ms, default 800
       fadeOut: 420,                     // ms, default 400
     });

     bed.start();   // begins playback + ramps to base * effGain
     bed.stop();    // ramps down + pauses (call between scenes)
     bed.destroy(); // call on minigame teardown — releases the
                    // audio element + unsubscribes from
                    // SaprosAudio change events

   ============================================================
   What it does for you
   ============================================================

   1. Routes the bed's playback volume through
      SaprosAudio.effectiveGain() at all times. The HUD mute
      toggle and the main-game volume slider drive your bed.

   2. Subscribes to SaprosAudio.onChange so changes propagate
      LIVE — you do not need to poll or restart the bed when
      the player adjusts volume mid-minigame.

   3. Caps the bed's own contribution at `base` (e.g. 0.22 means
      the bed never exceeds 22% volume even at full system
      volume), then multiplies by effGain. So mute → 0,
      slider at 50% → 0.11, full → 0.22.

   4. If SaprosAudio is not present (extremely unlikely — the
      engine installs it on first minigame start), falls back
      to base × 1, no crash.

   5. iOS Safari safe — uses the plain `audio.volume` property,
      not Web Audio's MediaElementSource. The main engine has
      to work around iOS's MediaElementSource volume-ignore bug
      with a GainNode, but for one-off looping beds the simpler
      route works fine on every iOS version we test.

   ============================================================
   Load order
   ============================================================

   index.html loads this file IMMEDIATELY AFTER
   `minigames/shared/audio-control.js`, which defines the
   placeholder `window.SaprosAudio`. Then `engine.js` lazily
   overwrites that placeholder with a Settings-bridged shim on
   first minigame start. Either way, by the time your
   minigame's `start()` runs, `window.SaprosAudio` is real.

   ============================================================
   How a new minigame should use it
   ============================================================

   In your minigame module:

     function start(opts) {
       const audioUrl = (opts.audioBaseUrl || 'audio/') + 'm_suspense.mp3';
       const bed = SaprosAudioBed.create({ url: audioUrl, base: 0.22 });
       bed.start();

       // ... your gameplay ...

       function teardown() {
         bed.destroy();   // important — releases handles + listener
         // ... rest of your cleanup ...
       }
     }

   You DO NOT need to:
     - Read SaprosAudio yourself
     - Subscribe to its onChange
     - Multiply gain manually
     - Worry about iOS Safari volume quirks

   This module owns all of that.

   ============================================================ */

(function (global) {
  'use strict';

  function effGain() {
    const SA = global.SaprosAudio;
    if (SA && typeof SA.effectiveGain === 'function') {
      const v = SA.effectiveGain();
      return (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.min(1, v)) : 1;
    }
    return 1;
  }

  function create(opts) {
    opts = opts || {};
    const url     = opts.url || '';
    const base    = clamp01(typeof opts.base === 'number' ? opts.base : 0.18);
    const loop    = (opts.loop !== false);
    const fadeIn  = numOrDefault(opts.fadeIn,  800);
    const fadeOut = numOrDefault(opts.fadeOut, 400);

    const audio = new Audio(url);
    audio.loop = loop;
    audio.volume = 0;

    let playing  = false;   // start() has been called and stop() has not
    let target   = 0;       // 0..base, the pre-effGain target volume
    let rampRaf  = null;
    let unsub    = null;
    let destroyed = false;

    function apply() {
      if (destroyed) return;
      audio.volume = clamp01(target * effGain());
    }

    // Subscribe to live SaprosAudio changes (mute toggle, slider)
    if (global.SaprosAudio && typeof global.SaprosAudio.onChange === 'function') {
      unsub = global.SaprosAudio.onChange(apply);
    }

    function cancelRamp() {
      if (rampRaf != null) {
        cancelAnimationFrame(rampRaf);
        rampRaf = null;
      }
    }

    function start() {
      if (destroyed || playing) return;
      playing = true;
      try { audio.currentTime = 0; } catch (_) {}
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { /* autoplay blocked; silent is fine */ });
      }
      cancelRamp();
      const t0 = performance.now();
      (function step() {
        if (!playing || destroyed) return;
        const k = Math.min(1, (performance.now() - t0) / Math.max(1, fadeIn));
        target = base * k;
        apply();
        if (k < 1) rampRaf = requestAnimationFrame(step);
        else rampRaf = null;
      })();
    }

    function stop() {
      if (destroyed || !playing) return;
      const startTarget = target;
      cancelRamp();
      const t0 = performance.now();
      (function step() {
        if (destroyed) return;
        const k = Math.min(1, (performance.now() - t0) / Math.max(1, fadeOut));
        target = startTarget * (1 - k);
        apply();
        if (k < 1) {
          rampRaf = requestAnimationFrame(step);
        } else {
          rampRaf = null;
          playing = false;
          try { audio.pause(); } catch (_) {}
        }
      })();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelRamp();
      playing = false;
      try { audio.pause(); } catch (_) {}
      try { audio.src = ''; audio.load(); } catch (_) {}
      if (unsub) {
        try { unsub(); } catch (_) {}
        unsub = null;
      }
    }

    return { start, stop, destroy };
  }

  function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n) || 0));
  }
  function numOrDefault(n, d) {
    return (typeof n === 'number' && isFinite(n)) ? n : d;
  }

  global.SaprosAudioBed = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
