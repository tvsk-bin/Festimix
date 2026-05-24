# RME TotalMix OSC Engine for FestiMix

Small Java OSC communication layer for RME TotalMix FX.

It is intentionally separate from the Yamaha 01V SysEx backend.

## Classes

- `OscMessage` — minimal OSC 1.0 encoder
- `OscUdpClient` — UDP sender
- `OscEngine` — queued non-blocking sender
- `RmeTotalMixOsc` — TotalMix wrapper
- `RmeOscExample` — example

## Usage

```java
try (RmeTotalMixOsc rme = new RmeTotalMixOsc("127.0.0.1", 7001)) {
    rme.setVolume(1, 0.75f);
    rme.triggerMute(1);
    rme.eqFreq(2, 0.5f);
}
```

Do not send OSC directly from the audio callback. Use `OscEngine`.
