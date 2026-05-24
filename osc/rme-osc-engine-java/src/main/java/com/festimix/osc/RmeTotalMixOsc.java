package com.festimix.osc;

import java.io.Closeable;
import java.net.SocketException;
import java.net.UnknownHostException;

public final class RmeTotalMixOsc implements Closeable {
    private final OscEngine osc;

    public RmeTotalMixOsc(String host, int port) throws SocketException, UnknownHostException {
        this.osc = new OscEngine(host, port);
    }

    public OscEngine raw() { return osc; }

    public void setBankStartNormalized(float value) { osc.send("/setBankStart", clamp01(value)); }

    public void setBankStartIndex(int channelIndex, int maxChannels) {
        if (maxChannels <= 1) {
            setBankStartNormalized(0f);
        } else {
            float n = (float)Math.max(0, channelIndex) / (float)(maxChannels - 1);
            setBankStartNormalized(n);
        }
    }

    public void setOffsetInBankNormalized(float value) { osc.send("/setOffsetInBank", clamp01(value)); }
    public void selectBusOutput(float value) { osc.send("/1/busOutput", clamp01(value)); }

    public void setVolume(int slot1to8, float value) { osc.send("/1/volume" + slot(slot1to8), clamp01(value)); }
    public void setPan(int slot1to8, float value) { osc.send("/1/pan" + slot(slot1to8), clamp01(value)); }

    public void triggerMute(int slot1to8) { osc.trigger("/1/mute/" + slot(slot1to8) + "/1"); }
    public void triggerSolo(int slot1to8) { osc.trigger("/1/solo/" + slot(slot1to8) + "/1"); }
    public void triggerSelect(int slot1to8) { osc.trigger("/1/select/" + slot(slot1to8) + "/1"); }

    public void eqEnable(float value) { osc.send("/2/eqEnable", clamp01(value)); }
    public void eqFreq(int band1to3, float value) { osc.send("/2/eqFreq" + band(band1to3), clamp01(value)); }
    public void eqGain(int band1to3, float value) { osc.send("/2/eqGain" + band(band1to3), clamp01(value)); }
    public void eqQ(int band1to3, float value) { osc.send("/2/eqQ" + band(band1to3), clamp01(value)); }

    public void recallSnapshot(int snapshot1to8) {
        if (snapshot1to8 < 1 || snapshot1to8 > 8) throw new IllegalArgumentException("snapshot must be 1..8");
        int row = 9 - snapshot1to8;
        osc.trigger("/3/snapshots/" + row + "/1");
    }

    public void dim() { osc.trigger("/3/dim"); }
    public void mono() { osc.trigger("/3/mono"); }
    public void talkback() { osc.trigger("/3/talkback"); }

    private static int slot(int n) {
        if (n < 1 || n > 8) throw new IllegalArgumentException("slot must be 1..8");
        return n;
    }

    private static int band(int n) {
        if (n < 1 || n > 3) throw new IllegalArgumentException("band must be 1..3");
        return n;
    }

    private static float clamp01(float v) {
        if (Float.isNaN(v)) return 0f;
        return Math.max(0f, Math.min(1f, v));
    }

    @Override public void close() { osc.close(); }
}
