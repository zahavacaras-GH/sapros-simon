/* ============================================================
   SAPROS MINIGAMES — Simon (Echo)
   ------------------------------------------------------------
   Six-button Simon. Each button has a distinct color and tone.
   The game plays a sequence, the player repeats it, and one
   tone gets added each round. A wrong tap resets the streak
   to zero, but the game keeps going. Twenty correct in a row
   wins. The player ends the game either by winning or tapping
   the Skip button.

   Integration API:

     window.SaprosMinigames.simon.start({
       container,              // required: an empty DOM element
       lang,                   // 'en' (Hebrew + others fall back)
       audioBaseUrl,           // path to dir holding m_suspense.mp3
       onComplete,             // (result) => void
       onSkip,                 // (result) => void

       // Optional tuning — defaults shown
       targetStreak:    20,    // win when currentStreak hits this
       buttonCount:     6,
     });

   Outcomes:

     onComplete(result)  — fires when the player hits the target
                           streak.
     onSkip(result)      — fires when the player taps Skip (from
                           the splash OR mid-game).

   `result` shape (both callbacks):
     {
       outcome:        'cleared' | 'aborted',
       bestStreak:     number,    // 0..targetStreak
       currentStreak:  number,    // 0..targetStreak at moment of resolve
       totalTaps:      number,    // every input the player made
       totalWrong:     number,    // wrong taps across the whole run
       elapsedMs:      number,    // ms from begin() to resolve
       totalRounds:    number,    // sequence rounds attempted
       target:         number,    // copy of opts.targetStreak (20)
       stage:          'splash' | 'play',  // present on onSkip
     }

   Cleanup contract: by the time either callback returns, the
   container is empty, all audio is stopped, RAFs and timers
   are cancelled, listeners are removed, the AudioContext is
   closed.

   Audio: per-tone synth ONLY. No background music bed (the
   memory game needs silence between tones to read clearly). Tone
   peaks are scaled by SaprosAudio.effectiveGain() so the main
   game's mute / volume still drives them.

   Visuals: gold-on-black; six button colors drawn from the
   Sapros wave palette (cyan/amber/violet/green/ice/red) so it
   sits next to lockpick/sweep/drone in style.

   Narrative skin: intentionally NEUTRAL. The host engine
   decides what the scene IS — a coded handshake, a radio
   tuning, a memory exercise, a ritual. The minigame is just
   the mechanic + clean tones + abstract chrome.
   ============================================================ */

(function (global) {
  'use strict';
  global.SaprosMinigames = global.SaprosMinigames || {};

  // ----- constants ------------------------------------------------
  // A-minor-pentatonic-ish, ascending: C4 D4 E4 G4 A4 C5. Any
  // sequence of any subset sounds harmonic even if randomized.
  const TONE_FREQS = [262, 294, 330, 392, 440, 523];

  // Six distinct hues drawn from the Sapros wave palette so the
  // game shares a visual language with the other minigames.
  // The neutral resting color is dark; the lit color is what
  // pulses when the tone fires.
  const BUTTON_COLORS = [
    { rest: 'rgba(120, 220, 240, 0.32)', lit: 'rgba(120, 220, 240, 1)' },  // cyan
    { rest: 'rgba(255, 180,  80, 0.32)', lit: 'rgba(255, 180,  80, 1)' },  // amber
    { rest: 'rgba(200, 140, 255, 0.32)', lit: 'rgba(200, 140, 255, 1)' },  // violet
    { rest: 'rgba(140, 220, 110, 0.32)', lit: 'rgba(140, 220, 110, 1)' },  // green
    { rest: 'rgba(200, 240, 255, 0.32)', lit: 'rgba(200, 240, 255, 1)' },  // ice
    { rest: 'rgba(255, 110,  90, 0.32)', lit: 'rgba(255, 110,  90, 1)' },  // red
  ];

  const DEFAULTS = {
    targetStreak:        20,
    buttonCount:         6,
    // Playback timing
    noteDurMs:           320,
    noteGapMs:           120,
    postSequenceMs:      380,    // pause after playback before awaiting input
    advanceDelayMs:      520,    // pause after a correct round before next
    wrongFlashMs:        320,    // red wrong-flash duration
    replayAfterWrongMs:  720,    // pause after wrong before re-playing from tone 1
    // Per-tone audio
    notePeakGain:        0.18,   // before SaprosAudio.effectiveGain()
  };

  // ----- helpers --------------------------------------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
  function reducedMotion() {
    return typeof matchMedia === 'function' &&
           matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function tFor() {
    return function t(key, fallback) {
      if (global.SaprosI18n && typeof global.SaprosI18n.t === 'function') {
        const v = global.SaprosI18n.t(key);
        if (v && v !== key) return v;
      }
      return fallback != null ? fallback : key;
    };
  }

  // ================================================================
  // start(opts)
  // ================================================================
  function start(opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const container = o.container || document.body;
    const t         = tFor();
    const reduced   = reducedMotion();

    // ----- audio: per-tone synth only --------------------------
    // (Background music bed intentionally OMITTED. The memory game
    // needs silence between tones so the sequence reads clearly.
    // Per-tone synth peaks are still routed through
    // SaprosAudio.effectiveGain() so the main-game mute / volume
    // controls still drive them.)
    let audioCtx = null;
    function ensureAudioCtx() {
      if (audioCtx) return audioCtx;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
      return audioCtx;
    }
    function effGain() {
      return (global.SaprosAudio && global.SaprosAudio.effectiveGain)
        ? global.SaprosAudio.effectiveGain() : 1;
    }
    function playTone(idx, opts2) {
      const c = ensureAudioCtx();
      if (!c) return;
      try { if (c.state === 'suspended') c.resume(); } catch (_) {}
      const optsX = opts2 || {};
      const freq  = optsX.freq != null ? optsX.freq : (TONE_FREQS[idx] || 440);
      const dur   = (optsX.dur != null ? optsX.dur : o.noteDurMs) / 1000;
      const peak  = (optsX.peak != null ? optsX.peak : o.notePeakGain) * effGain();
      const t0    = c.currentTime;
      // Layer a sine fundamental + a quiet triangle harmonic for
      // body. Distinct envelope per tone (50ms attack, exponential
      // release).
      const osc1 = c.createOscillator();
      const osc2 = c.createOscillator();
      const gain = c.createGain();
      osc1.type = 'sine';     osc1.frequency.value = freq;
      osc2.type = 'triangle'; osc2.frequency.value = freq * 2;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const g2 = c.createGain();
      g2.gain.value = 0.18;   // harmonic at ~20% of fundamental
      osc1.connect(gain);
      osc2.connect(g2); g2.connect(gain);
      gain.connect(c.destination);
      osc1.start(t0); osc2.start(t0);
      osc1.stop(t0 + dur + 0.05);
      osc2.stop(t0 + dur + 0.05);
    }
    function playWrongTone() {
      const c = ensureAudioCtx(); if (!c) return;
      try { if (c.state === 'suspended') c.resume(); } catch (_) {}
      const t0 = c.currentTime;
      [180, 188].forEach((f) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        const peak = 0.16 * effGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
        osc.connect(gain); gain.connect(c.destination);
        osc.start(t0); osc.stop(t0 + 0.42);
      });
    }
    function playWinChime() {
      const c = ensureAudioCtx(); if (!c) return;
      try { if (c.state === 'suspended') c.resume(); } catch (_) {}
      const t0 = c.currentTime;
      // A rising arpeggio — C5 E5 G5 C6 (major triad → octave).
      [523, 659, 784, 1047].forEach((f, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle'; osc.frequency.value = f;
        const peak = 0.10 * effGain();
        const start = t0 + i * 0.09;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.connect(gain); gain.connect(c.destination);
        osc.start(start); osc.stop(start + 0.6);
      });
    }

    // ----- state -----------------------------------------------
    const state = {
      phase:           'splash',  // 'splash'|'showing'|'awaiting'|'between'|'over'
      sequence:        [],        // grows by one each successful round
      playerPos:       0,
      currentStreak:   0,
      bestStreak:      0,
      totalTaps:       0,
      totalWrong:      0,
      totalRounds:     0,
      tStart:          0,
      done:            false,
      timeoutIds:      [],
      rafId:           0,
    };
    function addTimeout(fn, ms) {
      const id = setTimeout(() => {
        const idx = state.timeoutIds.indexOf(id);
        if (idx >= 0) state.timeoutIds.splice(idx, 1);
        fn();
      }, ms);
      state.timeoutIds.push(id);
      return id;
    }

    // ----- DOM build -------------------------------------------
    container.classList.add('mg-host');
    const root = document.createElement('div');
    root.className = 'sim-root';
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', t('minigames.simon.title', 'Echo'));

    // Skip button — top-right (RTL flips via CSS .mg-skip)
    const skip = document.createElement('button');
    skip.className = 'mg-skip';
    skip.type = 'button';
    skip.setAttribute('aria-label', t('common.skip', 'Skip'));
    skip.innerHTML =
      '<span>' + escapeHtml(t('minigames.simon.btnQuit', 'Stop trying')) + '</span>' +
      '<span class="mg-skip-key">Esc</span>';
    root.appendChild(skip);

    // Stage — main play surface
    const stage = document.createElement('div');
    stage.className = 'sim-stage';

    const stageTitle = document.createElement('div');
    stageTitle.className = 'sim-stage-title';
    stageTitle.textContent = t('minigames.simon.title', 'Echo');
    stage.appendChild(stageTitle);

    const promptEl = document.createElement('div');
    promptEl.className = 'sim-prompt';
    promptEl.setAttribute('aria-live', 'polite');
    promptEl.textContent = '';
    stage.appendChild(promptEl);

    // Pad wrap: contains the 2×3 button grid + a vertical
    // progress bar that rises as the streak grows. The bar sits to
    // the right of the pad; on RTL it auto-flips via CSS.
    const padWrap = document.createElement('div');
    padWrap.className = 'sim-pad-wrap';

    const pad = document.createElement('div');
    pad.className = 'sim-pad';
    const nodeEls = [];
    for (let i = 0; i < o.buttonCount; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sim-node sim-node-' + i;
      btn.setAttribute('data-idx', String(i));
      btn.setAttribute('aria-label', 'Tone ' + (i + 1));
      btn.disabled = true;
      btn.style.setProperty('--rest', BUTTON_COLORS[i].rest);
      btn.style.setProperty('--lit',  BUTTON_COLORS[i].lit);
      btn.addEventListener('click', onNodeClick);
      pad.appendChild(btn);
      nodeEls.push(btn);
    }
    padWrap.appendChild(pad);

    // Vertical progress line — rises from 0% to 100% as the
    // currentStreak climbs from 0 to targetStreak (20).
    const progressEl = document.createElement('div');
    progressEl.className = 'sim-progress';
    progressEl.setAttribute('aria-label',
      'Progress 0 of ' + o.targetStreak);
    progressEl.setAttribute('role', 'progressbar');
    progressEl.setAttribute('aria-valuemin', '0');
    progressEl.setAttribute('aria-valuemax', String(o.targetStreak));
    progressEl.setAttribute('aria-valuenow', '0');
    const progressFill = document.createElement('div');
    progressFill.className = 'sim-progress-fill';
    progressEl.appendChild(progressFill);
    // Target cap marker (so the player sees where the line is
    // headed). The current-streak counter is intentionally absent
    // — the bar fills, that's the only feedback per the new design.
    const progressCap = document.createElement('div');
    progressCap.className = 'sim-progress-cap';
    progressCap.textContent = String(o.targetStreak);
    progressEl.appendChild(progressCap);
    padWrap.appendChild(progressEl);

    stage.appendChild(padWrap);

    root.appendChild(stage);

    // Splash overlay
    const splash = document.createElement('div');
    splash.className = 'sim-overlay sim-splash';
    const splashTitle = document.createElement('h1');
    splashTitle.className = 'sim-title';
    splashTitle.textContent = t('minigames.simon.title', 'Echo');
    const splashBody = document.createElement('p');
    splashBody.className = 'sim-body';
    splashBody.textContent = t('minigames.simon.startBody',
      'A pattern will play. Repeat it back. Each correct run adds one to the streak. Twenty in a row to win.');
    const splashBegin = document.createElement('button');
    splashBegin.type = 'button';
    splashBegin.className = 'sim-btn';
    splashBegin.textContent = t('minigames.simon.btnBegin', 'Begin');
    splashBegin.addEventListener('click', onBegin);
    splash.appendChild(splashTitle);
    splash.appendChild(splashBody);
    splash.appendChild(splashBegin);
    root.appendChild(splash);

    // Landscape gate — game is landscape-locked
    const rotateGate = document.createElement('div');
    rotateGate.className = 'sim-rotate';
    rotateGate.setAttribute('role', 'alertdialog');
    rotateGate.innerHTML =
      '<div class="sim-rotate-inner">' +
        '<div class="sim-rotate-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 110 70" width="92" height="58" fill="none" ' +
               'stroke="currentColor" stroke-width="1.5" ' +
               'stroke-linecap="round" stroke-linejoin="round">' +
            '<g class="sim-rotate-anim">' +
              '<rect x="44" y="6" width="22" height="58" rx="3" stroke-dasharray="3 3" opacity="0.45"/>' +
              '<rect x="8"  y="22" width="58" height="22" rx="3"/>' +
              '<path d="M 70 24 Q 84 14 96 26" stroke-dasharray="2 3"/>' +
              '<polyline points="96,26 90,22 92,30"/>' +
            '</g>' +
          '</svg>' +
        '</div>' +
        '<div class="sim-rotate-title">' + escapeHtml(t('minigames.simon.rotateTitle', 'Rotate your phone.')) + '</div>' +
        '<div class="sim-rotate-hint">' + escapeHtml(t('minigames.simon.rotateHint', 'This scene plays in portrait.')) + '</div>' +
      '</div>';
    root.appendChild(rotateGate);

    // Outcome overlay — built lazily inside finish()
    let outcomeEl = null;

    // Clear container + mount
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(root);

    // Initial UI state
    renderProgress();
    setPrompt('');
    requestAnimationFrame(() => splash.classList.add('is-shown'));
    addTimeout(() => { try { splashBegin.focus(); } catch (_) {} }, 60);

    // Listeners
    skip.addEventListener('click', onSkipClick);
    document.addEventListener('keydown', onKeydown);

    // ----- UI helpers ------------------------------------------
    function renderProgress() {
      // Fill height = currentStreak / targetStreak, clamped 0..1.
      // The line rises as the player gets more in a row, drops back
      // to 0 when they miss. CSS transitions the height change.
      const pct = clamp(state.currentStreak / o.targetStreak, 0, 1) * 100;
      progressFill.style.height = pct.toFixed(1) + '%';
      progressEl.setAttribute('aria-valuenow', String(state.currentStreak));
      progressEl.setAttribute('aria-label',
        'Progress ' + state.currentStreak + ' of ' + o.targetStreak);
    }
    function setPrompt(kind) {
      promptEl.classList.remove('is-listen', 'is-your', 'is-wrong');
      if (kind === 'listen') {
        promptEl.textContent = t('minigames.simon.promptListen', 'Listen.');
        promptEl.classList.add('is-listen');
      } else if (kind === 'your') {
        promptEl.textContent = t('minigames.simon.promptYourTurn', 'Your turn.');
        promptEl.classList.add('is-your');
      } else if (kind === 'wrong') {
        promptEl.textContent = t('minigames.simon.promptWrong', 'Wrong tone. Reset.');
        promptEl.classList.add('is-wrong');
      } else {
        promptEl.textContent = '';
      }
    }
    function setNodesEnabled(enabled) {
      for (const n of nodeEls) {
        n.disabled = !enabled;
        n.classList.toggle('is-disabled', !enabled);
      }
    }
    function pulseNode(idx, withTone) {
      const n = nodeEls[idx];
      if (!n) return;
      n.classList.add('is-pulse');
      addTimeout(() => n.classList.remove('is-pulse'), o.noteDurMs);
      if (withTone) playTone(idx);
    }
    function wrongFlashNode(idx) {
      const n = nodeEls[idx];
      if (!n) return;
      n.classList.add('is-wrong');
      addTimeout(() => n.classList.remove('is-wrong'), o.wrongFlashMs);
      playWrongTone();
    }

    // ----- sequence generation ---------------------------------
    function newSequence() {
      // Start with a single tone. The sequence grows by one each
      // successful round.
      state.sequence = [Math.floor(Math.random() * o.buttonCount)];
      state.playerPos = 0;
    }
    function extendSequence() {
      // Append one new tone. Mild anti-repeat: avoid three-in-a-row.
      let next = Math.floor(Math.random() * o.buttonCount);
      const L = state.sequence.length;
      if (L >= 2 && state.sequence[L - 1] === next && state.sequence[L - 2] === next) {
        next = (next + 1 + Math.floor(Math.random() * (o.buttonCount - 1))) % o.buttonCount;
      }
      state.sequence.push(next);
      state.playerPos = 0;
    }

    // ----- sequence playback -----------------------------------
    function playSequence() {
      if (state.done) return;
      state.phase = 'showing';
      setPrompt('listen');
      setNodesEnabled(false);
      state.playerPos = 0;
      state.totalRounds++;

      const stepMs = o.noteDurMs + o.noteGapMs;
      state.sequence.forEach((idx, i) => {
        addTimeout(() => {
          if (state.done) return;
          pulseNode(idx, true);
        }, i * stepMs);
      });
      addTimeout(() => {
        if (state.done) return;
        state.phase = 'awaiting';
        setPrompt('your');
        setNodesEnabled(true);
      }, state.sequence.length * stepMs + o.postSequenceMs);
    }

    // ----- input -----------------------------------------------
    function onNodeClick(e) {
      if (state.done || state.phase !== 'awaiting') return;
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
      if (!Number.isFinite(idx)) return;
      handleTap(idx);
    }
    function handleTap(idx) {
      state.totalTaps++;
      const expected = state.sequence[state.playerPos];
      if (idx === expected) {
        pulseNode(idx, true);
        state.playerPos++;
        if (state.playerPos >= state.sequence.length) {
          // Round complete
          state.currentStreak++;
          if (state.currentStreak > state.bestStreak) {
            state.bestStreak = state.currentStreak;
          }
          renderProgress();
          // Win condition
          if (state.currentStreak >= o.targetStreak) {
            state.phase = 'between';
            setNodesEnabled(false);
            addTimeout(() => { if (!state.done) playWinChime(); }, 120);
            addTimeout(() => { if (!state.done) finish('cleared'); }, o.advanceDelayMs + 360);
            return;
          }
          // Advance
          state.phase = 'between';
          setNodesEnabled(false);
          addTimeout(() => {
            if (state.done) return;
            extendSequence();
            playSequence();
          }, o.advanceDelayMs);
        }
      } else {
        // Wrong — streak resets, game continues
        wrongFlashNode(idx);
        state.totalWrong++;
        state.currentStreak = 0;
        renderProgress();
        state.phase = 'between';
        setNodesEnabled(false);
        setPrompt('wrong');
        addTimeout(() => {
          if (state.done) return;
          // Start a fresh single-tone sequence for the next round
          // (treating "reset to 0" as "begin from the start").
          newSequence();
          playSequence();
        }, o.replayAfterWrongMs);
      }
    }

    // ----- begin / skip / outcome ------------------------------
    function onBegin() {
      if (state.done) return;
      // Mark phase as 'between' the moment Begin is clicked, so a
      // fast Skip during the 520ms pre-playback delay reports the
      // skip as mid-game (stage='play'), not stage='splash'. The
      // player has committed to playing.
      state.phase = 'between';
      splash.classList.remove('is-shown');
      addTimeout(() => { try { splash.remove(); } catch (_) {} }, 360);
      state.tStart = performance.now();
      ensureAudioCtx();
      newSequence();
      renderProgress();
      addTimeout(() => {
        if (state.done) return;
        playSequence();
      }, 520);
    }
    function onSkipClick() {
      if (state.done) return;
      // From splash → stage='splash'; mid-game → stage='play'
      const stage = (state.phase === 'splash') ? 'splash' : 'play';
      finishSkip(stage);
    }
    function onKeydown(e) {
      if (state.done) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkipClick();
        return;
      }
      if (state.phase === 'splash') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onBegin();
        }
        return;
      }
      if (state.phase === 'awaiting') {
        // 1..6 keyboard maps to nodes
        if (e.key >= '1' && e.key <= '6') {
          e.preventDefault();
          handleTap(parseInt(e.key, 10) - 1);
        }
        return;
      }
      if (state.phase === 'over' && outcomeEl) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const primary = outcomeEl.querySelector('.sim-btn[data-primary="1"]');
          if (primary) primary.click();
        }
      }
    }

    function buildResult(outcomeStr, stageStr) {
      const elapsed = state.tStart ? Math.round(performance.now() - state.tStart) : 0;
      const r = {
        outcome:        outcomeStr,
        bestStreak:     state.bestStreak,
        currentStreak:  state.currentStreak,
        totalTaps:      state.totalTaps,
        totalWrong:     state.totalWrong,
        totalRounds:    state.totalRounds,
        elapsedMs:      elapsed,
        target:         o.targetStreak,
      };
      if (stageStr) r.stage = stageStr;
      return r;
    }

    function finish(outcome) {
      if (state.done) return;
      state.done = true;
      state.phase = 'over';
      setNodesEnabled(false);
      cancelAnimationFrame(state.rafId);

      const result = buildResult(outcome);
      outcomeEl = document.createElement('div');
      outcomeEl.className = 'sim-overlay sim-outcome sim-outcome-' + outcome;
      const line = document.createElement('p');
      line.className = 'sim-outcome-title';
      const body = document.createElement('p');
      body.className = 'sim-outcome-body';
      if (outcome === 'cleared') {
        line.textContent = t('minigames.simon.outcomeClearedTitle', 'Twenty.');
        body.textContent = t('minigames.simon.outcomeClearedBody', 'The pattern held all the way through.');
      } else {
        line.textContent = t('minigames.simon.outcomeAbortedTitle', 'Walked away.');
        body.textContent = t('minigames.simon.outcomeAbortedBody', 'The pattern is gone.');
      }
      outcomeEl.appendChild(line);
      outcomeEl.appendChild(body);

      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'sim-btn';
      continueBtn.setAttribute('data-primary', '1');
      continueBtn.textContent = t('common.continue', 'Continue');
      continueBtn.addEventListener('click', () => {
        cleanup();
        if (typeof o.onComplete === 'function') o.onComplete(result);
      });
      outcomeEl.appendChild(continueBtn);

      root.appendChild(outcomeEl);
      requestAnimationFrame(() => outcomeEl.classList.add('is-shown'));
      addTimeout(() => { try { continueBtn.focus(); } catch (_) {} }, 80);
    }

    function finishSkip(stageStr) {
      if (state.done) return;
      state.done = true;
      state.phase = 'over';
      const result = buildResult('aborted', stageStr);
      cleanup();
      if (typeof o.onSkip === 'function') o.onSkip(result);
    }

    // ----- cleanup ---------------------------------------------
    function cleanup() {
      state.done = true;
      cancelAnimationFrame(state.rafId);
      state.timeoutIds.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
      state.timeoutIds.length = 0;
      document.removeEventListener('keydown', onKeydown);
      try { skip.removeEventListener('click', onSkipClick); } catch (_) {}
      for (const n of nodeEls) {
        try { n.removeEventListener('click', onNodeClick); } catch (_) {}
      }
      try { if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); } catch (_) {}
      audioCtx = null;
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { cancel: () => finishSkip(state.phase === 'splash' ? 'splash' : 'play') };
  }

  global.SaprosMinigames.simon = { start: start };
})(typeof window !== 'undefined' ? window : globalThis);
