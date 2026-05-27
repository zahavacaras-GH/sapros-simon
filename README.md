# sapros-simon — Echo

A six-button Simon-style memory minigame intended for integration
into the main Sapros interactive-fiction game. **Narratively
neutral** — the host engine decides what the scene is. The
minigame is just the mechanic + tones + abstract chrome.

Live: `https://sapros-simon.vercel.app/`

## What it is

- 6 distinct color-coded buttons, each with a unique tone (A-minor-
  pentatonic-ish: C4, D4, E4, G4, A4, C5)
- The game plays a sequence, the player repeats it
- One correct round = streak +1, and one more tone is added
- Wrong tap = **streak resets to 0** but the game continues
- Win condition: **20 in a row**
- Game ends when the player either wins (cleared) or taps Skip (aborted)

## Integration

See `INTEGRATION.md` for the file-by-file integration spec into the
main Sapros codebase.

See `SIMON_AGENT_PROMPT.md` for a self-contained brief that can be
copy-pasted into the main-game AI agent's session — explains what
the minigame emits and what narrative decisions the agent owns.

## Source layout

```
index.html              gallery shell — single tile pointing to the minigame
site/
  minigames/simon/
    simon.js            the minigame module
    simon.css           styles
    index.html          demo harness for direct play
  shared/               shared modules — audio bed helper, i18n, etc.
  lang/en.json          English strings (hooks for other locales)
  audio/m_suspense.mp3  background bed
vercel.json             deploy config (cleanUrls + trailingSlash)
```

## License

Internal Sapros tooling. Not for redistribution.
