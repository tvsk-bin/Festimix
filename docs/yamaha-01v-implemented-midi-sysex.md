# Yamaha 01V implemented MIDI / SysEx mapping

This document describes the Yamaha 01V MIDI and SysEx functionality currently represented in `yamaha01v.mapping_v3.json`.

It is not a complete Yamaha 01V MIDI implementation chart. It is an implementation reference for Festimix: what is already mapped, what transport is used, what is validated, and what still needs hardware confirmation.

Source of truth:

```text
yamaha01v.mapping_v3.json
```

Current metadata from the mapping file:

| Field | Value |
|---|---|
| Manufacturer | Yamaha |
| Model | 01V |
| Protocol | MIDI + SysEx |
| Mapping version | 2.1-preliminary |
| Status | reverse-engineered |
| Last updated | 2026-05-12 |

Because the mapping is marked as reverse-engineered and preliminary, this document distinguishes between implemented, validated, partially confirmed, derived from sniff logs, and needs validation.

## 1. General MIDI / SysEx setup

The default MIDI channel is channel 1.

Local Control recommendation:

| Situation | Recommended Local Control |
|---|---|
| Runtime / normal app use | On |
| Sniffing / learning MIDI messages | Off |

The configured Yamaha SysEx header is:

```text
F0 43 1n 3E
```

Where:

| Byte | Meaning |
|---|---|
| `F0` | Start of SysEx |
| `43` | Yamaha manufacturer ID |
| `1n` | Yamaha device / MIDI channel byte |
| `3E` | Yamaha 01V model / format identifier |

The mapping also contains:

| Item | Message |
|---|---|
| Universal identity request | `F0 7E 7F 06 01 F7` |
| Scene-safe reset / function call | `F0 43 10 3E 04 02 00 00 7F F7` |

The scene-safe reset entry is marked as `confirmed_working_scene_00_function_call`.

## 2. Ignored SysEx patterns

The implementation intentionally ignores these patterns:

```text
F043303E042502F7
F043303E04254FF7
F043303E042550F7
F043303E042556F7
F043303E042567F7
```

These should be treated as non-actionable status/noise messages unless later testing proves otherwise. Incoming messages matching these patterns should not update UI state.

## 3. Raw SysEx commands

The `commands` section contains complete raw SysEx messages. These commands are not parameterized. They are sent as-is.

### 3.1 Effect presets

Implemented raw effect preset commands:

| Command ID | Description |
|---|---|
| `effect.preset.hall` | Effect preset 1: Reverb Hall |
| `effect.preset.room` | Effect preset 2: Reverb Room |
| `effect.preset.stage` | Effect preset 3: Reverb Stage |
| `effect.preset.plate` | Effect preset 4: Reverb Plate |
| `effect.preset.echo` | Effect preset 12: Echo |
| `effect.preset.delay` | Effect preset 8: Mono Delay |
| `effect.preset.chorus` | Effect preset 13: Chorus |
| `effect.preset.symphonic` | Effect preset 15: Symphonic |
| `effect1.preset.hall` | EFF1 effect preset 1: Reverb Hall |
| `effect1.preset.room` | EFF1 effect preset 2: Reverb Room |
| `effect1.preset.stage` | EFF1 effect preset 3: Reverb Stage |
| `effect1.preset.plate` | EFF1 effect preset 4: Reverb Plate |
| `effect1.preset.echo` | EFF1 effect preset 12: Echo |
| `effect1.preset.delay` | EFF1 effect preset 8: Mono Delay |
| `effect1.preset.chorus` | EFF1 effect preset 13: Chorus |
| `effect1.preset.symphonic` | EFF1 effect preset 15: Symphonic |

Safety: caution. These commands change a complete effect preset, not only one exposed UI parameter.

UI implication: effect preset buttons should call these command IDs through the central MIDI/SysEx transport, not build raw messages inside UI components.

### 3.2 Dynamics presets

Implemented raw master dynamics preset commands:

| Command ID | Description |
|---|---|
| `dynamicsPreset.master.comp` | MASTER dynamics preset: COMP |
| `dynamicsPreset.master.shape` | MASTER dynamics preset: SHAPE / Solo Vocal1 |
| `dynamicsPreset.master.glue` | MASTER dynamics preset: GLUE / Total Comp1 |
| `dynamicsPreset.master.limiter` | MASTER dynamics preset: LIMITER / Limiter1 |
| `dynamicsPreset.master.clipper` | MASTER dynamics preset: CLIPPER / Limiter2 |

Implemented AUX dynamics presets:

| Target | Implemented presets |
|---|---|
| AUX1 | COMP, VOCAL/SHAPE, GLUE, LIMITER |
| AUX2 | COMP, VOCAL/SHAPE, GLUE, LIMITER |
| AUX3 | COMP, VOCAL/SHAPE, GLUE, LIMITER |
| AUX4 | COMP, VOCAL/SHAPE, GLUE, LIMITER |

Safety: caution. These commands send complete preset dumps and can change several compressor parameters at once.

## 4. MIDI Control Change implementation

The `ccMappings` section is marked as validated and sourced from the Yamaha 01V default Control Change table.

### 4.1 Channel faders

| Target | CC |
|---|---|
| CH1 | 1 |
| CH2 | 2 |
| CH3 | 3 |
| CH4 | 4 |
| CH5 | 5 |
| CH6 | 6 |
| CH7 | 7 |
| CH8 | 8 |
| CH9 | 9 |
| CH10 | 10 |
| CH11 | 11 |
| CH12 | 12 |
| CH13/14 | 13 |
| CH15/16 | 14 |
| RTN1 | 15 |
| RTN2 | 16 |

The main MIX UI writes input channel faders through SysEx when `sysexParameters.channelFader` has a matching address. RTN1/RTN2 continue to use the effect-return master send SysEx route.

### 4.2 Master faders

| Target | CC |
|---|---|
| AUX1 | 17 |
| AUX2 | 18 |
| AUX3 | 19 |
| AUX4 | 20 |
| BUS1 | 21 |
| BUS2 | 22 |
| BUS3 | 23 |
| BUS4 | 24 |
| EFFECT1 | 25 |
| EFFECT2 | 26 |
| STEREO | 27 |

### 4.3 Channel ON

| Target | CC |
|---|---|
| CH1 | 28 |
| CH2 | 29 |
| CH3 | 30 |
| CH4 | 31 |
| CH5 | 33 |
| CH6 | 34 |
| CH7 | 35 |
| CH8 | 36 |
| CH9 | 37 |
| CH10 | 38 |
| CH11 | 39 |
| CH12 | 40 |
| CH13/14 | 41 |
| CH15/16 | 42 |
| RTN1 | 43 |
| RTN2 | 44 |

Note: CC 32 is skipped in the Yamaha table.

### 4.4 Master ON

| Target | CC |
|---|---|
| AUX1 | 45 |
| AUX2 | 46 |
| AUX3 | 47 |
| AUX4 | 48 |
| BUS1 | 49 |
| BUS2 | 50 |
| BUS3 | 51 |
| BUS4 | 52 |
| EFFECT1 | 53 |
| EFFECT2 | 54 |
| STEREO | 55 |

### 4.5 Pan / balance

| Target | CC |
|---|---|
| CH1 | 56 |
| CH2 | 57 |
| CH3 | 58 |
| CH4 | 59 |
| CH5 | 60 |
| CH6 | 61 |
| CH7 | 62 |
| CH8 | 63 |
| CH9 | 64 |
| CH10 | 65 |
| CH11 | 66 |
| CH12 | 67 |
| CH13 L | 68 |
| CH13 R | 69 |
| CH15 L | 70 |
| CH15 R | 71 |
| RTN1 L | 72 |
| RTN1 R | 73 |
| RTN2 L | 74 |
| RTN2 R | 75 |
| Stereo balance | 76 |

### 4.6 FX sends via CC

FX1 send:

| Target | CC |
|---|---|
| CH1 | 91 |
| CH2 | 92 |
| CH3 | 93 |
| CH4 | 94 |
| CH5 | 95 |
| CH6 | 102 |
| CH7 | 103 |
| CH8 | 104 |
| CH9 | 105 |
| CH10 | 106 |
| CH11 | 107 |
| CH12 | 108 |
| CH13/14 | 109 |
| CH15/16 | 110 |

FX2 send:

| Target | CC |
|---|---|
| CH1 | 77 |
| CH2 | 78 |
| CH3 | 79 |
| CH4 | 80 |
| CH5 | 81 |
| CH6 | 82 |
| CH7 | 83 |
| CH8 | 84 |
| CH9 | 85 |
| CH10 | 86 |
| CH11 | 87 |
| CH12 | 88 |
| CH13/14 | 89 |
| CH15/16 | 90 |

Input channel FX sends are CC-based. Effect return sends and cross-sends are SysEx-based.

## 5. EQ implementation

EQ uses address-based SysEx.

Observed EQ parameter write format:

```text
F0 43 10 3E 04 30 aaH aaL value F7
```

Where:

| Field | Meaning |
|---|---|
| `F0 43 10 3E 04` | Yamaha 01V edit buffer SysEx family |
| `30` | 7-bit parameter write family |
| `aaH aaL` | 14-bit parameter address |
| `value` | 7-bit parameter value |
| `F7` | End of SysEx |

Address encoding:

```text
address = (aaH << 7) + aaL
```

### 5.1 EQ address formula

The mapping contains this address formula:

```text
address = baseLowFreqCh1 + ((channel - 1) * channelStride) + (bandIndex * bandStride) + parameterOffset
```

Configured values:

| Item | Value |
|---|---|
| Base LOW FREQ CH1 | `0x0120` |
| Channel stride | `0x01` |
| Band stride | `0x16` |
| FREQ offset | `0x000` |
| GAIN offset | `0x058` |
| Q offset | `0x0B0` |

Bands:

| Band | Index |
|---|---|
| LOW | 0 |
| LO_MID | 1 |
| HI_MID | 2 |
| HIGH | 3 |

The explicit expanded EQ address table should override the formula where present.

### 5.2 Channel EQ model

Status:

```text
implemented_authoritative_simplified_channel_eq
```

The UI does not expose the full Yamaha 4-band parametric EQ. It provides a simplified musical channel EQ:

| UI control | Yamaha implementation |
|---|---|
| HPF | Uses Yamaha LOW band as HPF |
| BASS | Uses Yamaha LO_MID with Q fixed to 1 and frequency fixed at 125 Hz |
| MID | Uses Yamaha HI_MID with Q fixed to 1 and selectable UI frequency |
| HIGH | Uses Yamaha HIGH shelf with frequency fixed at 8000 Hz |

Important raw values:

| Function | Raw value |
|---|---|
| Q = 1 | `0x14` |
| HPF mode | `0x2C` |
| Low shelf mode | `0x00` |
| HPF 75 Hz | `0x16` |
| HPF 100 Hz | `0x1B` |
| HPF off frequency | `0x1B` |
| HPF gain on | `0x24` |
| HPF gain off | `0x22` |
| Bass fixed 125 Hz | `0x1F` |
| High shelf mode | `0x2A` |
| High fixed 8000 Hz | `0x6B` |

MID frequency table:

| Frequency | Raw |
|---|---|
| 250 Hz | `0x2B` |
| 500 Hz | `0x37` |
| 1000 Hz | `0x43` |
| 2000 Hz | `0x4F` |
| 4000 Hz | `0x5B` |

### 5.3 Master EQ model

Status:

```text
implemented_authoritative_fast_musical_master_eq
```

Behavior:

| Band | Type |
|---|---|
| LOW | Shelf |
| LO_MID | Bell |
| HI_MID | Bell |
| HIGH | Shelf |

Q is fixed internally at 1.0 and is not exposed in the UI.

Important raw values:

| Function | Raw |
|---|---|
| Q = 1 | `0x14` |
| Low shelf mode | `0x29` |
| High shelf mode | `0x2A` |

Master frequency tables:

| LOW | Raw |
|---|---|
| 60 Hz | `0x11` |
| 80 Hz | `0x17` |
| 100 Hz | `0x1B` |
| 120 Hz | `0x1F` |

| LO_MID | Raw |
|---|---|
| 250 Hz | `0x2B` |
| 400 Hz | `0x34` |
| 630 Hz | `0x3C` |
| 1000 Hz | `0x43` |

| HI_MID | Raw |
|---|---|
| 1000 Hz | `0x43` |
| 2000 Hz | `0x4F` |
| 4000 Hz | `0x5B` |
| 6000 Hz | `0x62` |

| HIGH | Raw |
|---|---|
| 8000 Hz | `0x6B` |
| 10000 Hz | `0x70` |
| 12000 Hz | `0x73` |

### 5.4 AUX monitor EQ model

Status:

```text
implemented_authoritative_aux_monitor_eq
```

Purpose: fast monitor feedback control.

| UI function | Yamaha implementation |
|---|---|
| HPF | Radio-style HPF interaction |
| LOW NOTCH | Narrow fixed-Q cut |
| HIGH NOTCH | Narrow fixed-Q cut |
| INIT boost | Temporary boost mode for finding feedback |
| PRESENCE | Fixed presence EQ |

Important raw values:

| Function | Raw |
|---|---|
| HPF mode | `0x2C` |
| HPF off mode | `0x00` |
| HPF gain on | `0x24` |
| HPF gain off | `0x22` |
| Notch Q | `0x02` |
| Presence Q | `0x18` |
| Presence 5000 Hz | `0x60` |

HPF frequency table:

| Frequency | Raw |
|---|---|
| 75 Hz | `0x16` |
| 100 Hz | `0x1B` |
| 175 Hz | `0x26` |
| 250 Hz | `0x2B` |

Notch ranges:

| Notch | Hz range | Raw range |
|---|---|---|
| LOW NOTCH | 100-1000 Hz | `0x1B`-`0x43` |
| HIGH NOTCH | 800-6000 Hz | `0x40`-`0x62` |

### 5.5 Effect return EQ model

Status:

```text
implemented_authoritative_effect_return_eq
```

This is dedicated EQ for RTN1 and RTN2 shaping. It is not the same as an effect master bus EQ.

| Page | Target |
|---|---|
| EFF1 page | RTN1 EQ |
| EFF2 page | RTN2 EQ |

UI behavior:

| UI control | Yamaha implementation |
|---|---|
| HPF | Uses fixed HPF values |
| LOW | Fixed 125 Hz gain control |
| MID | Fixed 2500 Hz gain control |
| AIR | Fixed 10000 Hz gain control |

Raw values:

| Function | Raw |
|---|---|
| Q = 1 | `0x14` |
| HPF mode | `0x2C` |
| HPF off mode | `0x00` |
| HPF gain on | `0x24` |
| HPF gain off | `0x22` |
| Low fixed 125 Hz | `0x1F` |
| Mid fixed 2500 Hz | `0x52` |
| Air fixed 10000 Hz | `0x70` |

## 6. Navigation

The mapping says navigation is confirmed.

Known pages:

```text
HOME
EQ
DYNAMICS
VIEW
OPTION
```

## 7. Stereo channel behavior

Stereo channels `CH13_14` and `CH15_16` are marked as linked.

Important note:

```text
SELECT cannot self-toggle on Yamaha 01V.
```

Implementation implications:

- Stereo channels must be handled differently from mono channels.
- L/R-specific pan or phase logic may require two physical channel operations.
- SELECT should be treated as a momentary selection, not as a toggle state.

## 8. Master section SysEx addresses

### 8.1 AUX masters

| Target | Address |
|---|---|
| AUX1 | `0x001C` |
| AUX2 | `0x001D` |
| AUX3 | `0x001E` |
| AUX4 | `0x001F` |

### 8.2 FX masters

| Target | Address |
|---|---|
| FX1 | `0x0025` |
| FX2 | `0x0026` |

The FX master fader addresses are derived from FX master and return fader logs.

### 8.3 Stereo master

| Target | Address |
|---|---|
| STEREO | `0x0024` |

The stereo address is marked as confirmed from master fader logs on different pages.

### 8.4 MIX input channel faders

| Target | Address |
|---|---|
| CH1 | `0x000C` |
| CH2 | `0x000D` |
| CH3 | `0x000E` |
| CH4 | `0x000F` |
| CH5 | `0x0010` |
| CH6 | `0x0011` |
| CH7 | `0x0012` |
| CH8 | `0x0013` |
| CH9 | `0x0014` |
| CH10 | `0x0015` |
| CH11 | `0x0016` |
| CH12 | `0x0017` |
| CH13/14 | `0x0018` |
| CH15/16 | `0x0019` |

These are inferred as the contiguous MIX fader block before the existing RTN1/RTN2 master send addresses `0x001A` and `0x001B`, and before the known master fader block at `0x001C` onward.

## 9. Pan SysEx parameters

Pan SysEx uses 0..32 values, with center at 16. Mono input channels use one pan address; stereo channels and effect returns use separate L/R pan addresses.

| Target | Address |
|---|---|
| CH1 | `0x0360` |
| CH2 | `0x0361` |
| CH3 | `0x0362` |
| CH4 | `0x0363` |
| CH5 | `0x0364` |
| CH6 | `0x0365` |
| CH7 | `0x0366` |
| CH8 | `0x0367` |
| CH9 | `0x0368` |
| CH10 | `0x0369` |
| CH11 | `0x036A` |
| CH12 | `0x036B` |
| CH13 L | `0x0374` |
| CH13 R | `0x0375` |
| CH15 L | `0x0376` |
| CH15 R | `0x0377` |
| RTN1 L | `0x0378` |
| RTN1 R | `0x0379` |
| RTN2 L | `0x037A` |
| RTN2 R | `0x037B` |

Validated from: `D:\Github-hatterinfok\Yamaha 01v sysex\pan 1-eff2.log`.

## 10. Attenuator parameters

The mapping contains attenuation addresses intended for future level/trim logic.

Known values:

| Meaning | Raw |
|---|---|
| Mono/stereo -3 dB | `0x5D` |
| Unity | `0x60` |

Known addresses:

| Target | Side | Address |
|---|---|---|
| CH13/14 | Left | `0x03E2` |
| CH13/14 | Right | `0x03E3` |
| CH15/16 | Left | `0x03E3` |

This area appears incomplete and should be validated before production use.

## 11. Effect return send SysEx

Effect return send implementation is marked as validated.

Transport:

| Field | Value |
|---|---|
| Family | `F0 43 10 3E 04` |
| Value encoding | 7-bit |
| Send rule | send exact stored prefix bytes |

General format:

```text
F0 43 10 3E 04 <stored-prefix...> <value> F7
```

### 11.1 Master sends

| Target | Prefix |
|---|---|
| effRtn1 | `30 00 1A` |
| effRtn2 | `30 00 1B` |

### 11.2 Effect cross-sends

| Bus | Return | Prefix |
|---|---|---|
| EFF1 | RTN2 | `30 01 04` |
| EFF2 | RTN1 | `30 01 05` |

### 11.3 AUX sends from effect returns

| AUX | Return | Prefix |
|---|---|---|
| AUX1 | RTN1 | `30 00 7B` |
| AUX1 | RTN2 | `30 00 7C` |
| AUX2 | RTN1 | `30 00 7D` |
| AUX2 | RTN2 | `30 00 7E` |
| AUX3 | RTN1 | `30 00 7F` |
| AUX3 | RTN2 | `30 01 00` |
| AUX4 | RTN1 | `30 01 01` |
| AUX4 | RTN2 | `30 01 02` |

Effect return send levels should use these stored prefixes, not calculated addresses.

## 12. AUX sends

Status:

```text
derived_from_aux_1-4_master_and_channels_log
```

Message family:

```text
editBufferParameter7bitObserved
```

Preferred send behavior:

```text
use editBuffer7bitWrite prefix when writing unless hardware test proves 0x30 is required
```

### 12.1 AUX master addresses

| AUX | Address |
|---|---|
| AUX1 | `0x001C` |
| AUX2 | `0x001D` |
| AUX3 | `0x001E` |
| AUX4 | `0x001F` |

### 12.2 AUX send address ranges

| AUX | Mono channel range | Stereo channel addresses |
|---|---|---|
| AUX1 | CH1 `0x0027` to CH12 `0x0032` | CH13/14 `0x006F`, CH15/16 `0x0070` |
| AUX2 | CH1 `0x0033` to CH12 `0x003E` | CH13/14 `0x0071`, CH15/16 `0x0072` |
| AUX3 | CH1 `0x003F` to CH12 `0x004A` | CH13/14 `0x0073`, CH15/16 `0x0074` |
| AUX4 | CH1 `0x004B` to CH12 `0x0056` | CH13/14 `0x0075`, CH15/16 `0x0076` |

## 13. Dynamics / compressor implementation

Status:

```text
preliminary_derived_from_sniff_logs
```

This part is implemented but not fully authoritative.

### 13.1 Dynamics SysEx transport

On/off format:

```text
F0 43 10 3E 04 60 aaH aaL encodedValue F7
```

Wide parameter format:

```text
F0 43 10 3E 04 00 aaH aaL valueH valueL F7
```

Wide value encoding:

```text
valueH = (raw >> 7) & 0x7F
valueL = raw & 0x7F
```

Address encoding:

```text
address = (aaH << 7) + aaL
```

### 13.2 Compressor bundle order

The intended compressor parameter bundle order is:

```text
ON_OFF
THRESHOLD
RATIO
ATTACK
RELEASE
KNEE
OUT_GAIN
```

### 13.3 Dynamics target offsets

For dynamics parameters except ON/OFF:

```text
decodedAddress = decodedBaseAddress + targetOffset
```

| Target | Offset |
|---|---|
| CH1 | 0 |
| CH2 | 1 |
| CH3 | 2 |
| CH4 | 3 |
| CH5 | 4 |
| CH6 | 5 |
| CH7 | 6 |
| CH8 | 7 |
| CH9 | 8 |
| CH10 | 9 |
| CH11 | 10 |
| CH12 | 11 |
| CH13/14 | 12 |
| CH15/16 | 13 |
| AUX1 | 14 |
| AUX2 | 15 |
| AUX3 | 16 |
| AUX4 | 17 |
| STEREO | 18 |

### 13.4 Dynamics ON/OFF groups

| Target group | Address |
|---|---|
| CH1-CH8 | `0x0258` |
| CH9-CH15/16 | `0x0259` |
| AUX1-AUX4 + STEREO | `0x025A` |

For ON values, the mapping uses:

```text
enabledOffset = 0x08
```

### 13.5 Dynamics parameters

| Parameter | Address | Encoding | Real range / values |
|---|---|---|---|
| THRESHOLD | `0x02A6` | linear7bit | -54 dB to 0 dB |
| RATIO | `0x027E` | enum7bit | 1:1 to INF |
| ATTACK | `0x02BA` | linear7bit | 0-120 ms |
| RELEASE | `0x02E2` | logWide | 6-46000 ms |
| KNEE | `0x0292` | enumWide | hard, 1, 2, 3, 4, 5 |
| OUT_GAIN | `0x02CE` | linear7bit | 0-18 dB |

The mapping states that Release and Knee were re-measured separately and should override earlier ambiguous interpretation.

## 14. Button SysEx

Status:

```text
partially_confirmed
```

### 14.1 Channel ON/OFF observed SysEx

Family:

```text
F0 43 10 3E 04 60 01 31 data F7
```

The logs begin with OFF, therefore the first value is treated as OFF and the second as ON.

| Target | OFF | ON |
|---|---|---|
| CH13/14 | `0x04` | `0x0C` |
| CH15/16 | `0x05` | `0x0D` |
| RTN1 | `0x06` | `0x0E` |
| RTN2 | `0x07` | `0x0F` |

### 14.2 Master ON/OFF observed SysEx

Family:

```text
F0 43 10 3E 04 60 01 34 data F7
```

| Target | OFF | ON |
|---|---|---|
| STEREO | `0x07` | `0x0F` |

### 14.3 Phase reverse

Phase reverse is validated.

Source:

```text
reverse 1-16 on 16-1 off.log
```

Important behavior:

```text
Phase exists only for input channels.
OFF is the lower value.
ON is lower value + 0x08.
Stereo UI pairs send both physical channels.
```

Families:

| Channel range | Family |
|---|---|
| CH1-CH8 | `F0 43 10 3E 04 60 01 36 data F7` |
| CH9-CH16 | `F0 43 10 3E 04 60 01 37 data F7` |

### 14.4 SELECT SysEx

Family:

```text
F0 43 10 3E 04 23 01 channelCode 10 00 F7
```

Known channel codes:

| Target | Channel code | Full message |
|---|---|---|
| CH1 | `0x00` | `F0 43 10 3E 04 23 01 00 10 00 F7` |
| CH13/14 | `0x0C` | `F0 43 10 3E 04 23 01 0C 10 00 F7` |
| CH15/16 | `0x0D` | `F0 43 10 3E 04 23 01 0D 10 00 F7` |
| RTN1 | `0x0E` | `F0 43 10 3E 04 23 01 0E 10 00 F7` |
| RTN2 | `0x0F` | `F0 43 10 3E 04 23 01 0F 10 00 F7` |

SELECT should not be treated as a toggle state.

Do not use `F0 43 10 3E 04 23 01 channelCode 01 04 F7` or `F0 43 10 3E 04 23 01 channelCode 09 02 F7` for software channel select. Those families can change Yamaha display pages; keep them only as channel-code references.

### 14.5 SOLO SysEx

Solo is observed but not fully validated.

Families:

```text
F0 43 10 3E 04 61 00 10 data F7
F0 43 10 3E 04 61 00 0A data F7
```

The mapping says solo appears to emit or require paired messages, and exact on/off direction still needs validation.

Known observed value pairs exist for:

- CH13/14
- CH15/16
- RTN1
- RTN2

Recommendation: do not rely on SOLO as production-safe until exact on/off direction is confirmed.

## 15. Logic engine concept

The mapping explicitly defines a higher-level logic engine concept.

Core rule:

```text
UI controls should not directly represent Yamaha parameters.
```

Intended architecture:

```text
UI intent -> logic engine -> Yamaha parameter bundle -> MIDI/SysEx sender
```

This is especially important for:

- simplified channel EQ
- AUX monitor EQ
- effect return EQ
- one-knob compressor
- compressor presets
- future support for other mixers/devices

## 16. Smart EQ concept

Smart EQ is enabled as a concept, not necessarily as fully validated low-level behavior.

Ideas listed in the mapping:

- Adaptive Q based on boost/cut direction
- Automatic shelf behavior
- Program-dependent EQ response

Status: conceptual / future enhancement.

## 17. Known validation gaps

The mapping explicitly lists these items as needing validation:

```text
AUX send write test using preferred prefix
Dynamics OUT_GAIN exact role
Dynamics RATIO exact role
Exact H.SHELF value
Exact LPF mode value
Exact Q=1 encoded value
Exact frequency encoding table
Master EQ addresses
ON/OFF exact state direction for stereo/returns
ON/OFF state values
RTN select logic
Solo exact on/off direction
Stereo master addresses
```

Some of these items are already partly implemented or partly confirmed elsewhere in the mapping. They should remain flagged until checked on hardware.

## 18. Practical implementation summary

### 18.1 Safe / validated enough for normal UI

| Area | Transport | Status |
|---|---|---|
| Channel faders | SysEx preferred, MIDI CC fallback | input SysEx inferred; CC validated |
| Master faders | MIDI CC | validated |
| Channel ON | MIDI CC | validated |
| Master ON | MIDI CC | validated |
| Pan / balance | MIDI CC | validated |
| FX sends from input channels | MIDI CC | validated |
| Channel EQ simplified model | SysEx address-based | implemented authoritative |
| Master EQ model | SysEx address-based | implemented authoritative |
| AUX monitor EQ | SysEx address-based | implemented authoritative |
| Effect return EQ | SysEx address-based | implemented authoritative |
| Phase reverse | SysEx button family | validated |

### 18.2 Works but should be treated with caution

| Area | Reason |
|---|---|
| Effect raw presets | Sends whole preset dump |
| Dynamics raw presets | Sends whole preset dump |
| AUX sends | Derived from logs; preferred write prefix still needs hardware confirmation |
| Dynamics parameter editing | Preliminary derived from sniff logs |

### 18.3 Not yet production-safe

| Area | Reason |
|---|---|
| SOLO | Paired messages observed, exact on/off direction not validated |
| Some stereo/return ON/OFF SysEx | Direction and state values still need validation |
| Smart EQ | Concept only |
| Attenuator / trim logic | Incomplete / future use |

## 19. Duplex incoming support

v3 contains a first-pass incoming MIDI/SysEx translator for hardware-to-UI updates.

Runtime rule:

```text
Outgoing Yamaha 01V control remains SysEx-first where the app already uses SysEx.
Incoming Yamaha 01V feedback accepts both Control Change and SysEx, because the hardware does not emit SysEx for every front-panel move while the DSP/control surface are coupled.
```

Currently mapped incoming feedback:

| UI area | Incoming transport | Status |
|---|---|---|
| Channel faders | MIDI CC 1-16 | implemented |
| Master faders | MIDI CC 17-27 and SysEx edit-buffer addresses | implemented |
| Channel ON | MIDI CC 28-44 and observed SysEx button families | implemented |
| Master ON | MIDI CC 45-55 and observed SysEx button families | implemented |
| Pan / balance | MIDI CC 56-76 and known stereo/return SysEx pan addresses | implemented |
| Phase reverse | observed SysEx button families | implemented |
| Input FX sends | MIDI CC fx1/fx2 tables | implemented |
| AUX sends | known SysEx edit-buffer addresses | implemented |
| Effect return sends | known SysEx stored-prefix messages | implemented |

Still needs hardware validation:

- Whether the console emits CC or SysEx for each of these controls in every operating page when the Yamaha interface is actively controlling the DSP.
- Exact behavior for paired stereo pan feedback. The UI can update from a single L/R message, but richer inference of Stereo/Wide/Narrow/Mono is intentionally conservative.
- Solo feedback remains excluded from automatic duplex state because the existing capture notes say the on/off direction and paired-message behavior still need validation.
- EQ, dynamics, HPF, presets, scene state, attenuator/trim and detailed effect parameters remain command/write oriented until enough incoming captures exist.

## 20. Maintenance rule

Whenever `yamaha01v.mapping_v3.json` is changed, this document should be checked and updated.

Recommended rule for implementation code:

```text
UI components should call logical command IDs and parameter objects.
Only the MIDI/SysEx layer should encode raw Yamaha byte streams.
```
