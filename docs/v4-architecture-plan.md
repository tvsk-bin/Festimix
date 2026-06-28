# Festimix v4 Architecture Plan

## Goals

- Keep `v3-yamaha-stable` as the stable Yamaha 01V maintenance line.
- Build v4 from the current OSC/pre-release branch without changing main until v4 is tested.
- Treat Yamaha 01V and RME Babyface as separate mixer implementations behind a shared UI.
- Keep Yamaha startup in assist mode by default. The legacy master/tablet-only mode may remain available through environment overrides, but it is not offered interactively.

## Target Shape

```text
lib/
  mixers/
    yamaha01v/
      profile.js
      transport.js
      layout.js
    rmeBabyfaceProFs12/
      profile.js
      transport.js
      layout.js
  midi/
  engine/
```

The existing code does not need to jump to this shape in one commit. The first v4 work should move decisions toward explicit mixer capabilities, then move code once the boundaries are stable.

## Split Boundaries

- Mixer profile: channel banks, bus names, returns, EQ bands, compressor support, solo policy, and startup defaults.
- Transport adapter: Yamaha MIDI/SysEx vs Babyface OSC.
- Layout adapter: Yamaha channel strip/raw EQ vs Babyface channel strip/raw EQ.
- Shared UI helpers: faders, buttons, raw EQ pad gestures, scene/copy flows, meters where behavior is truly common.

## First Milestones

1. Default Yamaha startup to assist mode and stop offering master mode during startup.
2. Move mixer-specific UI decisions out of broad `isBabyfaceMode()` checks and into profile/capability helpers.
3. Split channel-strip rendering into Yamaha and Babyface branches while keeping shared control helpers.
4. Split Yamaha MIDI/SysEx and Babyface OSC transport code into mixer-owned modules.
5. Update the online demo deliberately after Yamaha v4 behavior is verified.

## Verification Loop

- `npm.cmd run test:mapping`
- Inline script syntax parse for `index.html`
- Manual Yamaha smoke test: assist startup, CH13/14 raw EQ, AUX/EFF sends, solo, meter.
- Manual Babyface smoke test: OSC startup, channel strip, effects, player, meter/spectrum.
