"use strict";

module.exports = {
    id: "yamaha01vDefault",
    label: "Yamaha 01V",
    integration: "midi",
    controlProfile: "yamaha01vDefault",
    startup: {
        appMode: "assist",
        offerAppModePrompt: false
    },
    capabilities: {
        mixer: {
            id: "yamaha01vDefault",
            label: "Yamaha 01V",
            integration: "midi",
            layout: "yamaha",
            channelCount: 16,
            playbackChannels: false,
            returnChannels: true,
            effectBusCount: 2,
            effectParameterRows: 1,
            optionalInputBank: true
        },
        solo: {
            permissionModes: {
                view: false,
                mix: true,
                all: true
            },
            channelSelection: "additive",
            masterSelection: "radio",
            groupSelection: "exclusive",
            busCount: 1
        },
        rawEq: {
            gainRangeDb: [-18, 18]
        }
    }
};
