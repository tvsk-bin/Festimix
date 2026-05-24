"use strict";

var fs = require("fs");
var path = require("path");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadModuleConfig(configPath) {
    var target = configPath || path.join(__dirname, "..", "..", "processing-modules.json");
    return JSON.parse(fs.readFileSync(target, "utf8"));
}

function ModuleRegistry(config) {
    this.config = config || loadModuleConfig();
}

ModuleRegistry.prototype.getModule = function(moduleId) {
    var module = this.config.modules && this.config.modules[moduleId];
    if (!module) throw new Error("Unknown processing module: " + moduleId);
    return clone(module);
};

ModuleRegistry.prototype.getProfile = function(profileId) {
    var profile = this.config.profiles && this.config.profiles[profileId];
    if (!profile) throw new Error("Unknown processing module profile: " + profileId);
    return clone(profile);
};

ModuleRegistry.prototype.getAssignedModuleId = function(profileId, pageId, slotId, userId) {
    var userAssignments = userId &&
        this.config.userAssignments &&
        this.config.userAssignments[userId] &&
        this.config.userAssignments[userId][pageId] &&
        this.config.userAssignments[userId][pageId].slots;
    if (userAssignments && userAssignments[slotId]) return userAssignments[slotId];

    var profile = this.getProfile(profileId);
    var page = profile.slotAssignments && profile.slotAssignments[pageId];
    if (!page || !page.slots || !page.slots[slotId]) {
        throw new Error("No processing module assigned for " + profileId + "." + pageId + "." + slotId);
    }
    return page.slots[slotId];
};

ModuleRegistry.prototype.getAssignedModule = function(profileId, pageId, slotId, userId) {
    return this.getModule(this.getAssignedModuleId(profileId, pageId, slotId, userId));
};

ModuleRegistry.prototype.describeAssignments = function(profileId, userId) {
    var profile = this.getProfile(profileId);
    var result = clone(profile.slotAssignments || {});
    var self = this;
    Object.keys(result).forEach(function(pageId) {
        var slots = result[pageId].slots || {};
        Object.keys(slots).forEach(function(slotId) {
            slots[slotId] = self.getAssignedModule(profileId, pageId, slotId, userId);
        });
    });
    return result;
};

module.exports = {
    ModuleRegistry: ModuleRegistry,
    loadModuleConfig: loadModuleConfig
};
