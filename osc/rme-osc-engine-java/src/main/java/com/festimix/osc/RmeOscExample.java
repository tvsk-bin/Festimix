package com.festimix.osc;

public final class RmeOscExample {
    public static void main(String[] args) throws Exception {
        try (RmeTotalMixOsc rme = new RmeTotalMixOsc("127.0.0.1", 7001)) {
            rme.selectBusOutput(1.0f);
            rme.setBankStartIndex(0, 64);
            rme.setVolume(1, 0.75f);
            rme.triggerSelect(1);
            rme.eqEnable(1.0f);
            rme.eqFreq(2, 0.50f);
            rme.eqGain(2, 0.60f);
            rme.recallSnapshot(1);
            Thread.sleep(200);
        }
    }
}
