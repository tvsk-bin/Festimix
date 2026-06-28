"use strict";

var path = require("path");

module.exports = {
    id: "rmeBabyfaceProFs12",
    label: "Babyface Pro FS 12ch",
    integration: "osc",
    controlProfile: "rmeBabyfaceProFs12",
    workspaceFile: path.join(__dirname, "..", "..", "..", "data", "festimix-babyface-pro-fs-12.json"),
    startup: {
        appMode: "assist",
        spectrumInput: "3-4"
    },
    capabilities: {
        mixer: {
            id: "rmeBabyfaceProFs12",
            label: "Babyface Pro FS 12ch",
            integration: "osc",
            layout: "babyface",
            channelCount: 12,
            fixedInputChannels: true,
            playbackChannels: true,
            returnChannels: false,
            effectBusCount: 1,
            effectParameterRows: 2,
            workspaceFile: "data/festimix-babyface-pro-fs-12.json",
            optionalInputBank: false
        },
        solo: {
            permissionModes: {
                view: false,
                mix: true,
                all: true
            },
            channelSelection: "single",
            masterSelection: "radio",
            groupSelection: "exclusive",
            busCount: 2,
            role: "pfl",
            modeSource: "totalmix",
            meter: {
                source: "oscLevel",
                selection: "single",
                spectrum: false
            }
        },
        rawEq: {
            gainRangeDb: [-20, 20],
            bandCount: 3,
            hasHpf: true,
            hpfFixed: true,
            gainCompensation: false
        },
        eq: {
            channelBands: 3,
            channelHpfSlope: "12dB/oct",
            channelQ: 1,
            highMode: "shelf",
            masterBands: 3,
            masterFixedFrequencies: true
        },
        compressor: {
            channel: false,
            aux: false,
            master: false
        },
        controls: {
            phantom: true,
            phase: true,
            panMode: "stereoOutputRatio",
            effectSends: ["eff1"]
        },
        returns: {
            eq: false,
            pan: false,
            sends: false,
            volume: true
        }
    }
};
