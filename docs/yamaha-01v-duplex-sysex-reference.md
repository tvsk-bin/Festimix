# Yamaha 01V duplex SysEx reference for Festimix

This document is a standalone reconstruction note for the Yamaha 01V duplex work added to Festimix V3/main in May 2026.

Its purpose is to preserve the MIDI/SysEx knowledge separately from the source code, so a future developer can rebuild the same duplex behavior even if the implementation is lost or rewritten.

## Important hardware limitation

When the Yamaha 01V DSP and control surface are linked normally, some SysEx feedback does not appear on the MIDI output. In that mode, the tablet can still send reliable SysEx commands to the Yamaha, but Yamaha-to-tablet feedback may be incomplete or absent for some controls.

Observed consequence:

- Tablet-to-Yamaha SysEx writes are preferred and usually stable.
- Yamaha-to-tablet duplex feedback must use whatever the console actually emits in the current DSP/control-surface mode.
- For some controls the useful feedback is CC rather than SysEx.
- For solo, the useful feedback is an absolute SysEx state family, not the key-remote toggle message.

## Implementation files

Current code locations:

- `yamaha01v.mapping_v3.json`
  - Stores static SysEx/CC mapping data.
  - Important sections: `sysexParameters`, `auxSends`, `effectSends`, `buttonSysex`, `channelSelectRemote`, `masterSoloMonitorOutAssign`, `eqExpandedCh1toCh8`, `eqExpandedTargets`.
- `lib/midi/mappingEngine.js`
  - Builds outgoing messages in `parameterMessage`, `buttonPackets`, `masterSoloPackets`.
  - Decodes incoming MIDI in `incomingEvents`.
  - Important reverse functions: `reverseCcEvent`, `reverseAddressEvent`, `reverseObservedButtonEvent`, `reverseMasterSoloEvent`, `reverseKeyRemoteSoloEvent`, `reverseRawEqEvent`.
- `lib/midi/service.js`
  - Sends outgoing SysEx/CC through `sendParameter`, `setChannelSolo`, `setMasterSolo`, etc.
  - Exposes incoming UI events through `mapIncomingToUi`.
- `app.js`
  - Receives MIDI input and emits mapped events to the browser as `midi incoming`.
  - Logs raw incoming SysEx and selected mapped events.
- `index.html`
  - Applies incoming events in `applyMidiIncoming`.
  - Important handlers: `applyIncomingChannelFader`, `applyIncomingMasterFader`, `applyIncomingChannelOn`, `applyIncomingMasterOn`, `applyIncomingChannelSelect`, `applyIncomingChannelSolo`, `applyIncomingMasterSolo`, `applyIncomingPhase`, `applyIncomingPan`, `applyIncomingAuxSend`, `applyIncomingFxSend`, `applyIncomingEffectReturnSend`, `applyIncomingRawEq`.
- `test/yamaha-mapping-smoke.js`
  - Smoke tests for outbound and inbound mapping.

## Packet conventions

Most 7-bit edit buffer writes use:

```text
F0 43 10 3E 04 30 aaH aaL value F7
```

Where:

- `address = (aaH << 7) + aaL`
- `value` is 0-127

Some button/state packets use:

```text
F0 43 10 3E 04 60 ...
F0 43 10 3E 04 61 ...
F0 43 10 3E 04 23 ...
F0 43 10 3E 04 43 ...
```

Incoming decoding should tolerate SysEx packets with or without final `F7`. Some drivers may deliver the end byte inconsistently.

## Outgoing duplex writes

### Channel faders

Normal channel faders are SysEx writes:

```text
channelFader.CH1      0x000C -> F0 43 10 3E 04 30 00 0C value F7
channelFader.CH2      0x000D
...
channelFader.CH12     0x0017
channelFader.CH13_14  0x0018
channelFader.CH15_16  0x0019
```

These are stored in `sysexParameters.channelFader`.

Incoming reverse mapping for the same address family should emit:

```json
{
  "group": "channelFader",
  "target": "CH1",
  "channelId": "1",
  "value": 64
}
```

### Master faders

Master faders are SysEx writes in `sysexParameters.masterFader`.

Known addresses:

```text
STEREO   0x0024
AUX1     0x001C
AUX2     0x001D
AUX3     0x001E
AUX4     0x001F
EFFECT1  0x0026
EFFECT2  0x0025
```

Important UI note:

- Current Festimix UI intentionally maps EFF1/EFF2 labels through the existing effect master logic. Do not flip this without hardware testing.
- User confirmed EFF master fader send and receive were stable.

### AUX sends

AUX channel sends are SysEx writes from `auxSends.sends`.

Known first addresses:

```text
AUX1 CH1  0x0027
AUX2 CH1  0x0033
AUX3 CH1  0x003F
AUX4 CH1  0x004B
```

Each mono channel CH1-CH12 increments by 1 within each AUX block.

Stereo channels:

```text
AUX1 CH13_14  0x006F
AUX1 CH15_16  0x0070
AUX2 CH13_14  0x0071
AUX2 CH15_16  0x0072
AUX3 CH13_14  0x0073
AUX3 CH15_16  0x0074
AUX4 CH13_14  0x0075
AUX4 CH15_16  0x0076
```

Incoming reverse mapping emits:

```json
{
  "group": "auxSend",
  "aux": "AUX1",
  "target": "CH1",
  "channelId": "1",
  "value": 64
}
```

### Effect sends from channels

This was restored because EFF1/EFF2 tablet-to-Yamaha failed when falling back to CC.

Use SysEx writes from `effectSends.sends`.

Current mapping:

```text
fx2Send CH1      0x0057
fx2Send CH2      0x0058
...
fx2Send CH12     0x0062
fx2Send CH13_14  0x0077
fx2Send CH15_16  0x0078

fx1Send CH1      0x0063
fx1Send CH2      0x0064
...
fx1Send CH12     0x006E
fx1Send CH13_14  0x0079
fx1Send CH15_16  0x007A
```

Examples:

```text
fx2Send.1 value 64 -> F0 43 10 3E 04 30 00 57 40 F7
fx1Send.1 value 64 -> F0 43 10 3E 04 30 00 63 40 F7
```

The UI currently uses the existing crossed effect send convention:

```text
UI eff1 -> fx2Send
UI eff2 -> fx1Send
EFF1 bus fader group -> fx2Send
EFF2 bus fader group -> fx1Send
```

Do not change that convention unless tested on hardware, because earlier working versions used it.

Incoming feedback:

- CC feedback for `fx1Send` and `fx2Send` remains supported.
- SysEx feedback from `effectSends` addresses is also decoded.

### Effect return sends

Effect return send writes use exact stored 3-byte prefixes in `sysexParameters.effectReturnSend`.

Examples:

```text
MIX bus RTN1 send  -> F0 43 10 3E 04 30 00 1A value F7
MIX bus RTN2 send  -> F0 43 10 3E 04 30 00 1B value F7
EFF1 RTN2 send     -> F0 43 10 3E 04 30 01 04 value F7
EFF2 RTN1 send     -> F0 43 10 3E 04 30 01 05 value F7
```

Reverse mapping emits:

```json
{
  "group": "effectReturnSend",
  "bus": "master",
  "target": "effRtn1",
  "channelId": "RTN1",
  "value": 64
}
```

## Incoming duplex feedback

### Channel select

Yamaha channel select feedback can arrive as:

```text
F0 43 10 3E 04 23 01 channelCode 05 00 F7
```

Known channel codes:

```text
0x00 CH1
0x01 CH2
0x02 CH3
0x03 CH4
0x04 CH5
0x05 CH6
0x06 CH7
0x07 CH8
0x08 CH9
0x09 CH10
0x0A CH11
0x0B CH12
0x0C CH13_14
0x0D CH15_16
0x0E RTN1
0x0F RTN2
0x16 STEREO
```

Implementation should emit:

```json
{
  "group": "channelSelect",
  "target": "CH6",
  "channelId": "6"
}
```

The browser stores this as Yamaha-selected channel state and also updates the visible selected strip.

### Channel solo absolute feedback

Important discovery:

The useful Yamaha-to-tablet solo messages are not key-remote toggles. They are absolute state packets.

Lower bank, CH1-CH8:

```text
F0 43 10 3E 04 61 00 0F value F7
```

Meaning:

```text
value 0x00-0x07 -> OFF for CH1-CH8
value 0x08-0x0F -> ON  for CH1-CH8
channel index = value % 8
```

Examples from hardware:

```text
F0 43 10 3E 04 61 00 0F 04 F7 -> CH5 solo OFF
F0 43 10 3E 04 61 00 0F 0D F7 -> CH6 solo ON
F0 43 10 3E 04 61 00 0F 05 F7 -> CH6 solo OFF
F0 43 10 3E 04 61 00 0F 0E F7 -> CH7 solo ON
```

Upper bank, CH9-CH12, stereo channels, returns:

```text
F0 43 10 3E 04 61 00 10 value F7
```

Meaning:

```text
value 0x00 / 0x08 -> CH9    OFF / ON
value 0x01 / 0x09 -> CH10   OFF / ON
value 0x02 / 0x0A -> CH11   OFF / ON
value 0x03 / 0x0B -> CH12   OFF / ON
value 0x04 / 0x0C -> CH13_14 OFF / ON
value 0x05 / 0x0D -> CH15_16 OFF / ON
value 0x06 / 0x0E -> RTN1    OFF / ON
value 0x07 / 0x0F -> RTN2    OFF / ON
```

Examples:

```text
F0 43 10 3E 04 61 00 10 08 F7 -> CH9 solo ON
F0 43 10 3E 04 61 00 10 00 F7 -> CH9 solo OFF
F0 43 10 3E 04 61 00 10 0E F7 -> RTN1 solo ON
F0 43 10 3E 04 61 00 10 06 F7 -> RTN1 solo OFF
```

Browser action:

- Update `state.solo[channel.id]`.
- Do not send a command back to Yamaha from incoming feedback.
- If a channel solo becomes ON, clear master solo UI state locally.

### Solo companion/global state

The console often emits this alongside channel solo:

```text
F0 43 10 3E 04 61 00 0A 0D F7
F0 43 10 3E 04 61 00 0A 05 F7
```

Current behavior:

- Ignore these for channel solo.
- They are companion/global solo-state messages and do not identify the channel.

### Key-remote solo fallback

Some logs contain key-remote style solo messages:

```text
F0 43 10 3E 04 43 00 64 data F7
F0 43 10 3E 04 43 00 65 data F7
```

Mapping:

```text
0x64 data 0x08-0x0F -> CH1-CH8 press/toggle
0x64 data 0x00-0x07 -> CH1-CH8 release
0x65 data 0x08-0x0F -> CH9, CH10, CH11, CH12, CH13_14, CH15_16, RTN1, RTN2 press/toggle
0x65 data 0x00-0x07 -> same bank release
```

Current intended behavior:

- Decode press as `channelSolo` with `toggle: true`.
- Decode release as `channelSolo` with `release: true`.
- Browser ignores release.

This is a fallback only. Prefer absolute `61 00 0F/10` solo state when available.

### Master solo / monitor delegation

Master solo is implemented as monitor-out delegation. Packets are stored in `masterSoloMonitorOutAssign`.

Important packets:

```text
STEREO ON   F0 43 10 3E 04 61 00 0D 08 F7
STEREO OFF  F0 43 10 3E 04 61 00 0D 00 F7

AUX1 ON     F0 43 10 3E 04 61 00 0E 08 F7
AUX1 OFF    F0 43 10 3E 04 61 00 0E 00 F7
AUX2 ON     F0 43 10 3E 04 61 00 0E 09 F7
AUX2 OFF    F0 43 10 3E 04 61 00 0E 01 F7
AUX3 ON     F0 43 10 3E 04 61 00 0E 0A F7
AUX3 OFF    F0 43 10 3E 04 61 00 0E 02 F7
AUX4 ON     F0 43 10 3E 04 61 00 0E 0B F7
AUX4 OFF    F0 43 10 3E 04 61 00 0E 03 F7
```

EFF master solo is routed through RTN solos:

```text
EFF1 master solo ON  -> RTN1 solo ON, RTN2 solo OFF
EFF1 master solo OFF -> RTN1 solo OFF
EFF2 master solo ON  -> RTN1 solo OFF, RTN2 solo ON
EFF2 master solo OFF -> RTN2 solo OFF
```

Browser action:

- Incoming `masterSolo` ON clears channel solo state locally.
- Incoming `masterSolo` OFF clears that master solo state locally.
- Do not send commands back from incoming feedback.

### Channel on/off

Channel on/off uses observed absolute SysEx families in `buttonSysex.onOffObserved`.

General values:

```text
low values  0x00-0x07 -> OFF
high values 0x08-0x0F -> ON
```

Example CH1:

```text
F0 43 10 3E 04 60 01 30 00 F7 -> CH1 OFF
F0 43 10 3E 04 60 01 30 08 F7 -> CH1 ON
```

CH1-CH8 use family `60 01 30`, CH9-CH16 and returns use `60 01 31`.

### Master on/off

Master on/off uses `buttonSysex.masterOnObserved`.

Important families:

```text
STEREO uses 60 01 34
AUX1-4 use 60 01 32
EFFECT1-2 use 60 01 33
```

Low values are OFF, high values are ON.

### Phase

Phase feedback uses `buttonSysex.phaseObserved`.

Families:

```text
CH1-8  -> F0 43 10 3E 04 60 01 36 data F7
CH9-16 -> F0 43 10 3E 04 60 01 37 data F7
```

Low values OFF, high values ON.

Stereo channels have paired physical values.

### Pan

Pan uses edit buffer 7-bit writes in `sysexParameters.pan`.

Examples:

```text
CH1       0x0360 -> F0 43 10 3E 04 30 06 60 value F7
CH12      0x036B
CH13_L    0x0374
CH13_R    0x0375
CH15_L    0x0376
CH15_R    0x0377
RTN1_L    0x0378
RTN1_R    0x0379
RTN2_L    0x037A
RTN2_R    0x037B
```

Browser pan value is converted from raw MIDI range into UI range `-16..16`.

Stereo channel pan behavior follows Festimix width mode:

- `Stereo`: pan slider disabled/gray.
- `Wide`, `Narrow`, `Mono`: pan active with mode-specific range.

### Raw EQ

Raw EQ duplex is address based.

Channel EQ addresses are in:

```text
eqExpandedCh1toCh8
eqExpandedTargets
```

Incoming reverse mapping emits:

```json
{
  "group": "rawEq",
  "target": "1",
  "channelId": "1",
  "band": "LOW",
  "parameter": "GAIN",
  "control": "gain",
  "value": 36
}
```

Band/control conversion:

```text
LOW      -> low
LO_MID   -> lowMid
HI_MID   -> highMid
HIGH     -> high

FREQ      -> freq
GAIN      -> gain
Q         -> q
Q_OR_TYPE -> q
```

Example:

```text
F0 43 10 3E 04 30 02 78 24 F7 -> CH1 LOW GAIN value 0x24
```

Browser action:

- Update raw EQ state only.
- Do not send back to Yamaha from incoming feedback.

## Reconstruction checklist

To recreate this duplex behavior in another codebase:

1. Load a mapping file containing the address tables described above.
2. For tablet-to-Yamaha writes, prefer SysEx for:
   - channel faders
   - master faders
   - AUX sends
   - EFF sends
   - effect return sends
   - pan
   - phase
   - on/off
   - raw EQ
   - master solo delegation
3. For Yamaha-to-tablet input, decode:
   - CC feedback for legacy faders and send controls where available.
   - Edit buffer `30 aaH aaL value` packets by address.
   - Button/state families `60` and `61`.
   - Channel select family `23 01 channelCode ...`.
4. Emit normalized UI events, for example:
   - `channelFader`
   - `masterFader`
   - `channelOn`
   - `masterOn`
   - `channelSelect`
   - `channelSolo`
   - `masterSolo`
   - `phase`
   - `pan`
   - `auxSend`
   - `fx1Send`
   - `fx2Send`
   - `effectReturnSend`
   - `rawEq`
5. Browser/UI must apply incoming events locally and must not echo them back to Yamaha.
6. For solo, treat `61 00 0F/10` as absolute state. Do not rely on tablet-selected channel.
7. Tolerate packets without trailing `F7`.

## Debugging notes

Useful server logs:

```text
Incoming SysEx: ...
Mapped MIDI incoming: ...
```

If an `Incoming SysEx` line appears without a corresponding `Mapped MIDI incoming` line for the same control, the parser is missing that packet pattern.

If `Mapped MIDI incoming` appears but the tablet does not update, the browser-side `applyMidiIncoming` branch is missing or failing.

If the tablet update works but the Yamaha flips the wrong direction on the next tablet press, the tablet state was not synchronized before sending. For solo, this usually means the absolute `61 00 0F/10` feedback was not decoded.

## Known uncertain or hardware-dependent areas

- Yamaha DSP linked mode may suppress outgoing SysEx. This is the central reason this reference exists.
- Some feedback may only be available when the control surface is detached from DSP.
- `61 00 0A 0D/05` is observed as a companion/global solo state. It should not be used as a channel identifier.
- EFF1/EFF2 send naming is historically crossed in the UI (`eff1 -> fx2Send`, `eff2 -> fx1Send`). Preserve unless tested.
- EFF master faders were reported stable and should not be changed without a specific failing log.

