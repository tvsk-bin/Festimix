"use strict";

function rangeMap(startChannel, endChannel, startCc) {
    var map = {};
    for (var channel = startChannel; channel <= endChannel; channel++) {
        map[channel] = startCc + (channel - startChannel);
    }
    return map;
}

function addControls(profile) {
    profile.controls = {};
    Object.keys(profile.maps).forEach(function(group) {
        Object.keys(profile.maps[group]).forEach(function(key) {
            profile.controls[group + ":" + key] = profile.maps[group][key];
        });
    });
    profile.controlFromCc = {};
    Object.keys(profile.controls).forEach(function(control) {
        var cc = profile.controls[control];
        if (cc !== null && cc !== undefined) {
            profile.controlFromCc[cc] = control;
        }
    });
    return profile;
}

var yamaha01vDefault = addControls({
    id: "yamaha01vDefault",
    name: "Yamaha 01V Default",
    capabilities: {
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
        }
    },
    maps: {
        channelFader: Object.assign(rangeMap(1, 12, 1), { 13: 13, 14: 13, 15: 14, 16: 14 }, rangeMap(17, 24, 111)),
        channelOn: Object.assign(rangeMap(1, 4, 28), rangeMap(5, 12, 33), { 13: 41, 14: 41, 15: 42, 16: 42 }),
        pan: Object.assign(rangeMap(1, 16, 56), { stereo: 76 }),
        masterFader: {
            aux1: 17,
            aux2: 18,
            aux3: 19,
            aux4: 20,
            effect1: 25,
            effect2: 26,
            stereo: 27
        },
        masterOn: {
            aux1: 45,
            aux2: 46,
            aux3: 47,
            aux4: 48,
            effect1: 53,
            effect2: 54,
            stereo: 55
        },
        fx1Send: Object.assign(rangeMap(1, 12, 77), { 13: 89, 14: 89, 15: 90, 16: 90 }),
        fx2Send: Object.assign(rangeMap(1, 5, 91), rangeMap(6, 12, 102), { 13: 109, 14: 109, 15: 110, 16: 110 })
    }
});

var legacyCustom = addControls({
    id: "legacyCustom",
    name: "Legacy Custom / 03D-compatible",
    capabilities: {
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
        }
    },
    maps: {
        channelFader: Object.assign(rangeMap(1, 12, 1), { 13: 25, 14: 25, 15: 13, 16: 13 }, rangeMap(17, 24, 17)),
        channelOn: Object.assign(rangeMap(1, 8, 64), rangeMap(9, 12, 72), { 13: 88, 14: 88, 15: 14, 16: 14 }, rangeMap(17, 24, 80)),
        pan: Object.assign(rangeMap(1, 12, 38), { 13: 62, 14: 63, 15: 15, 16: 16 }, rangeMap(17, 24, 54)),
        masterFader: {
            aux1: 28,
            aux2: 29,
            aux3: 30,
            aux4: 31,
            bus1: 33,
            bus2: 34,
            bus3: 35,
            bus4: 36,
            stereo: 37
        },
        masterOn: {
            aux1: 91,
            aux2: 92,
            aux3: 93,
            aux4: 94,
            bus1: 50,
            bus2: 51,
            bus3: 52,
            bus4: 53,
            stereo: 95
        }
    }
});

var yamaha01v03DCompatible = Object.assign({}, legacyCustom, {
    id: "yamaha01v03DCompatible",
    name: "Yamaha 01V 03D-compatible"
});

var profiles = {
    yamaha01vDefault: yamaha01vDefault,
    yamaha01v03DCompatible: yamaha01v03DCompatible,
    legacyCustom: legacyCustom
};

function getProfile(id) {
    return profiles[id] || profiles.yamaha01vDefault;
}

module.exports = {
    getProfile: getProfile,
    profiles: profiles,
    legacyCustom: legacyCustom
};
