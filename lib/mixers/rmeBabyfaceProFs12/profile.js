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
    }
};
