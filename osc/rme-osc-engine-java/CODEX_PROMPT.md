Add this Java RME TotalMix OSC communication layer to the FestiMix project.

Requirements:
1. Add package `com.festimix.osc`.
2. Keep Yamaha 01V SysEx/MIDI backend separate.
3. Add settings:
   - OSC enabled
   - host default `127.0.0.1`
   - port default `7001`
4. Use queued non-blocking sending only.
5. Never send UDP directly from the audio callback.
6. Map:
   - channel fader -> `/1/volume{slot}`
   - mute -> `/1/mute/{slot}/1`
   - solo -> `/1/solo/{slot}/1`
   - selected channel EQ enable -> `/2/eqEnable`
   - EQ band controls -> `/2/eqFreqN`, `/2/eqGainN`, `/2/eqQN`
   - snapshots -> `/3/snapshots/{row}/1`

Important:
RME TotalMix OSC is bank/context based, not Yamaha-style absolute addressing.
Keep state for bankStart, selectedSlot, bus/submix, and layer/row if needed.
