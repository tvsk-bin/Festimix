"use strict";

var profiles = [
    require("./yamaha01v/profile"),
    require("./rmeBabyfaceProFs12/profile")
];

function allMixerProfiles() {
    return profiles.slice();
}

function mixerProfileById(id) {
    return profiles.find(function(profile) { return profile.id === id; }) || profiles[0];
}

function configuredMixerProfile(defaultProfile) {
    var requested = process.env.FESTIMIX_MIXER_PROFILE || process.env.MIXER_PROFILE || "";
    if (!requested) return defaultProfile || profiles[0];
    return mixerProfileById(requested);
}

module.exports = {
    allMixerProfiles: allMixerProfiles,
    mixerProfileById: mixerProfileById,
    configuredMixerProfile: configuredMixerProfile
};
