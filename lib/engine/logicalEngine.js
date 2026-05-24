"use strict";

var path = require("path");
var ModuleRegistry = require("./moduleRegistry").ModuleRegistry;

function clamp(value, min, max) {
    var number = parseFloat(value);
    if (isNaN(number)) number = min;
    return Math.max(min, Math.min(max, number));
}

function gainDbToByte(value) {
    return Math.round((clamp(value, -18, 18) + 18) * 2);
}

function auxGainDbToByte(value) {
    return Math.round((clamp(value, -18, 12) + 18) * 2);
}

function effectReturnGainDbToByte(value) {
    return Math.round((clamp(value, -12, 12) + 18) * 2);
}

function parseNumber(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "number") return value;
    var text = String(value).trim().toLowerCase();
    if (text.indexOf("0x") === 0) return parseInt(text, 16);
    var parsed = parseInt(text, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function loadChannelEqConstants(mapping) {
    var raw = mapping && mapping.channelEqModel && mapping.channelEqModel.rawValues || {};
    var hpfFreq = raw.hpfFreq || {};
    var midFreq = raw.midFreq || {};
    return {
        qOne: parseNumber(raw.qOne, 0x14),
        bassFixedFreq125: parseNumber(raw.bassFixedFreq125, 0x1f),
        hiMidFreq: {
            250: parseNumber(midFreq["250"], 0x2b),
            500: parseNumber(midFreq["500"], 0x37),
            1000: parseNumber(midFreq["1000"], 0x43),
            2000: parseNumber(midFreq["2000"], 0x4f),
            4000: parseNumber(midFreq["4000"], 0x5b)
        },
        highShelfMode: parseNumber(raw.highShelfMode, 0x2a),
        highFixedFreq8000: parseNumber(raw.highFixedFreq8000, 0x6b),
        hpfMode: parseNumber(raw.hpfMode, 0x2c),
        lowShelfMode: parseNumber(raw.lowShelfMode, 0x2a),
        hpfFreq: {
            75: parseNumber(hpfFreq["75"], 0x16),
            100: parseNumber(hpfFreq["100"], 0x1b)
        },
        hpfOffFreq: parseNumber(raw.hpfOffFreq, parseNumber(hpfFreq["100"], 0x1b)),
        hpfGainOn: parseNumber(raw.hpfGainOn, 0x24),
        hpfGainOff: parseNumber(raw.hpfGainOff, 0x22)
    };
}

function loadMasterEqConstants(mapping) {
    var raw = mapping && mapping.masterEqModel && mapping.masterEqModel.rawValues || {};
    var frequencies = raw.frequencies || {};
    function freqMap(band, defaults) {
        var source = frequencies[band] || {};
        var result = {};
        Object.keys(defaults).forEach(function(freq) {
            result[freq] = parseNumber(source[freq], defaults[freq]);
        });
        return result;
    }
    return {
        qOne: parseNumber(raw.qOne, 0x14),
        lowShelfMode: parseNumber(raw.lowShelfMode, 0x00),
        highShelfMode: parseNumber(raw.highShelfMode, 0x2a),
        frequencies: {
            LOW: freqMap("LOW", {
                60: 0x11,
                80: 0x17,
                100: 0x1b,
                120: 0x1f
            }),
            LO_MID: freqMap("LO_MID", {
                250: 0x2b,
                400: 0x34,
                630: 0x3c,
                1000: 0x43
            }),
            HI_MID: freqMap("HI_MID", {
                1000: 0x43,
                2000: 0x4f,
                4000: 0x5b,
                6000: 0x62
            }),
            HIGH: freqMap("HIGH", {
                8000: 0x6b,
                10000: 0x70,
                12000: 0x73
            })
        }
    };
}

function loadAuxEqConstants(mapping) {
    var raw = mapping && mapping.auxEqModel && mapping.auxEqModel.rawValues || {};
    var hpfFreq = raw.hpfFreq || {};
    function rawRange(key, defaults) {
        var source = raw[key] || {};
        return {
            minHz: parseNumber(source.minHz, defaults.minHz),
            maxHz: parseNumber(source.maxHz, defaults.maxHz),
            minRaw: parseNumber(source.minRaw, defaults.minRaw),
            maxRaw: parseNumber(source.maxRaw, defaults.maxRaw)
        };
    }
    return {
        hpfMode: parseNumber(raw.hpfMode, 0x2c),
        hpfOffMode: parseNumber(raw.hpfOffMode, 0x00),
        hpfGainOn: parseNumber(raw.hpfGainOn, 0x24),
        hpfGainOff: parseNumber(raw.hpfGainOff, 0x22),
        hpfFreq: {
            75: parseNumber(hpfFreq["75"], 0x16),
            100: parseNumber(hpfFreq["100"], 0x1b),
            175: parseNumber(hpfFreq["175"], 0x26),
            250: parseNumber(hpfFreq["250"], 0x2b)
        },
        hpfOffFreq: parseNumber(raw.hpfOffFreq, parseNumber(hpfFreq["100"], 0x1b)),
        notchQ: parseNumber(raw.notchQ, 0x02),
        presenceQ: parseNumber(raw.presenceQ, 0x18),
        presenceFreq5000: parseNumber(raw.presenceFreq5000, 0x60),
        lowNotchFreqRawRange: rawRange("lowNotchFreqRawRange", { minHz: 100, maxHz: 1000, minRaw: 0x1b, maxRaw: 0x43 }),
        highNotchFreqRawRange: rawRange("highNotchFreqRawRange", { minHz: 800, maxHz: 6000, minRaw: 0x40, maxRaw: 0x62 })
    };
}

function loadEffectReturnEqConstants(mapping) {
    var raw = mapping && mapping.effectReturnEqModel && mapping.effectReturnEqModel.rawValues || {};
    var hpfFreq = raw.hpfFreq || {};
    return {
        qOne: parseNumber(raw.qOne, 0x14),
        hpfMode: parseNumber(raw.hpfMode, 0x2c),
        hpfOffMode: parseNumber(raw.hpfOffMode, 0x00),
        hpfGainOn: parseNumber(raw.hpfGainOn, 0x24),
        hpfGainOff: parseNumber(raw.hpfGainOff, 0x22),
        hpfFreq: {
            100: parseNumber(hpfFreq["100"], 0x1b),
            175: parseNumber(hpfFreq["175"], 0x26),
            250: parseNumber(hpfFreq["250"], 0x2b),
            500: parseNumber(hpfFreq["500"], 0x37)
        },
        hpfOffFreq: parseNumber(raw.hpfOffFreq, parseNumber(hpfFreq["100"], 0x1b)),
        lowFixedFreq125: parseNumber(raw.lowFixedFreq125, 0x1f),
        midFixedFreq2500: parseNumber(raw.midFixedFreq2500, 0x52),
        airFixedFreq10000: parseNumber(raw.airFixedFreq10000, 0x70)
    };
}

function logHzToRaw(value, range) {
    var hz = clamp(value, range.minHz, range.maxHz);
    var ratio = (Math.log(hz) - Math.log(range.minHz)) / (Math.log(range.maxHz) - Math.log(range.minHz));
    return Math.round(range.minRaw + ratio * (range.maxRaw - range.minRaw));
}

function LogicalEngine(options) {
    options = options || {};
    this.profile = options.profile || "yamaha01v";
    this.userId = options.userId || null;
    this.moduleRegistry = options.moduleRegistry || new ModuleRegistry(options.moduleConfig);
    this.mapping = options.mapping || require(path.join(__dirname, "..", "..", "yamaha01v.mapping_v3.json"));
    this.constants = loadChannelEqConstants(this.mapping);
    this.masterEqConstants = loadMasterEqConstants(this.mapping);
    this.auxEqConstants = loadAuxEqConstants(this.mapping);
    this.effectReturnEqConstants = loadEffectReturnEqConstants(this.mapping);
}

LogicalEngine.prototype.moduleFor = function(pageId, slotId) {
    return this.moduleRegistry.getAssignedModule(this.profile, pageId, slotId, this.userId);
};

LogicalEngine.prototype.moduleIntent = function(module, intentType, payload, commands) {
    return {
        type: "moduleIntent",
        moduleId: module.id,
        moduleType: module.type,
        displayName: module.displayName,
        intentType: intentType,
        authoritative: !!(module.engineBehavior && module.engineBehavior.authoritative),
        payload: payload || {},
        commands: commands || []
    };
};

LogicalEngine.prototype.writeEq = function(channel, band, parameter, value) {
    return {
        type: "writeEqParameter",
        channel: channel,
        band: band,
        parameter: parameter,
        value: value
    };
};

LogicalEngine.prototype.writeDynamicsBundle = function(target, values) {
    return {
        type: "writeDynamicsBundle",
        target: target,
        values: values
    };
};

LogicalEngine.prototype.setEqIntent = function(channel, control, value, state) {
    state = state || {};
    var module = this.moduleFor("channelPage", "tone");
    var commands = [];
    if (!channel) return [this.moduleIntent(module, "eq.channelTone", { channel: channel, control: control, value: value, state: state }, commands)];

    if (control === "hpf") {
        if (value === "75" || value === "100") {
            commands.push(this.writeEq(channel, "LOW", "Q_OR_TYPE", this.constants.hpfMode));
            commands.push(this.writeEq(channel, "LOW", "FREQ", this.constants.hpfFreq[value]));
            commands.push(this.writeEq(channel, "LOW", "GAIN", this.constants.hpfGainOn));
        } else {
            commands.push(this.writeEq(channel, "LOW", "FREQ", this.constants.hpfOffFreq));
            commands.push(this.writeEq(channel, "LOW", "GAIN", this.constants.hpfGainOff));
        }
    }

    if (control === "lowGain") {
        commands.push(this.writeEq(channel, "LO_MID", "Q", this.constants.qOne));
        commands.push(this.writeEq(channel, "LO_MID", "FREQ", this.constants.bassFixedFreq125));
        commands.push(this.writeEq(channel, "LO_MID", "GAIN", gainDbToByte(value)));
    }

    if (control === "midGain" || control === "midFrequency") {
        var freq = state.midFrequency || 250;
        var midGain = state.midGain !== undefined && state.midGain !== null ? state.midGain : (control === "midGain" ? value : 0);
        commands.push(this.writeEq(channel, "HI_MID", "Q", this.constants.qOne));
        commands.push(this.writeEq(channel, "HI_MID", "FREQ", this.constants.hiMidFreq[freq] || this.constants.hiMidFreq[250]));
        commands.push(this.writeEq(channel, "HI_MID", "GAIN", gainDbToByte(midGain)));
    }

    if (control === "highGain") {
        commands.push(this.writeEq(channel, "HIGH", "Q_OR_TYPE", this.constants.highShelfMode));
        commands.push(this.writeEq(channel, "HIGH", "FREQ", this.constants.highFixedFreq8000));
        commands.push(this.writeEq(channel, "HIGH", "GAIN", gainDbToByte(value)));
    }

    return [this.moduleIntent(module, "eq.channelTone", { channel: channel, control: control, value: value, state: state }, commands)];
};

LogicalEngine.prototype.setSendIntent = function(channelKey, bus, value) {
    return [{
        type: "sendParameter",
        parameterId: bus + "." + channelKey,
        value: value
    }];
};

LogicalEngine.prototype.masterEqTargetKey = function(target) {
    if (!target) return "STEREO";
    var key = String(target.midiKey || target.targetKey || target.id || target.masterId || "STEREO").toUpperCase();
    if (key === "STEREO" || key === "ST" || key === "MIX") return "STEREO";
    return key;
};

LogicalEngine.prototype.setMasterEqIntent = function(target, control, value, state) {
    state = state || {};
    var module = this.moduleFor("mixMasterPage", "tone");
    var targetKey = this.masterEqTargetKey(target);
    var constants = this.masterEqConstants;
    var commands = [];
    var controlMap = {
        lowGain: { band: "LOW", gainKey: "low", freqKey: "lowFrequency", defaultFreq: 80, typeParam: "Q_OR_TYPE", typeValue: constants.lowShelfMode },
        lowFrequency: { band: "LOW", gainKey: "low", freqKey: "lowFrequency", defaultFreq: 80, typeParam: "Q_OR_TYPE", typeValue: constants.lowShelfMode },
        lowMidGain: { band: "LO_MID", gainKey: "lowMid", freqKey: "lowMidFrequency", defaultFreq: 400, typeParam: "Q", typeValue: constants.qOne },
        lowMidFrequency: { band: "LO_MID", gainKey: "lowMid", freqKey: "lowMidFrequency", defaultFreq: 400, typeParam: "Q", typeValue: constants.qOne },
        highMidGain: { band: "HI_MID", gainKey: "highMid", freqKey: "highMidFrequency", defaultFreq: 2000, typeParam: "Q", typeValue: constants.qOne },
        highMidFrequency: { band: "HI_MID", gainKey: "highMid", freqKey: "highMidFrequency", defaultFreq: 2000, typeParam: "Q", typeValue: constants.qOne },
        highGain: { band: "HIGH", gainKey: "high", freqKey: "highFrequency", defaultFreq: 10000, typeParam: "Q_OR_TYPE", typeValue: constants.highShelfMode },
        highFrequency: { band: "HIGH", gainKey: "high", freqKey: "highFrequency", defaultFreq: 10000, typeParam: "Q_OR_TYPE", typeValue: constants.highShelfMode }
    };
    var config = controlMap[control];
    if (config) {
        var freq = state[config.freqKey] || config.defaultFreq;
        var gain = state[config.gainKey] !== undefined && state[config.gainKey] !== null ? state[config.gainKey] : (control.indexOf("Gain") >= 0 ? value : 0);
        var freqRaw = constants.frequencies[config.band] && constants.frequencies[config.band][freq];
        if (freqRaw === undefined) freqRaw = constants.frequencies[config.band][config.defaultFreq];
        commands.push(this.writeEq(targetKey, config.band, config.typeParam, config.typeValue));
        commands.push(this.writeEq(targetKey, config.band, "FREQ", freqRaw));
        commands.push(this.writeEq(targetKey, config.band, "GAIN", gainDbToByte(gain)));
    }
    return [this.moduleIntent(module, "eq.masterTone", { target: target, control: control, value: value, state: state }, commands)];
};

LogicalEngine.prototype.setAuxEqIntent = function(target, control, value, state) {
    state = state || {};
    var module = this.moduleFor("auxMasterPage", "tone");
    var targetKey = this.masterEqTargetKey(target);
    var constants = this.auxEqConstants;
    var commands = [];
    if (control === "hpf") {
        if (value === 75 || value === 100 || value === 175 || value === 250 || value === "75" || value === "100" || value === "175" || value === "250") {
            commands.push(this.writeEq(targetKey, "LOW", "Q_OR_TYPE", constants.hpfMode));
            commands.push(this.writeEq(targetKey, "LOW", "FREQ", constants.hpfFreq[value]));
            commands.push(this.writeEq(targetKey, "LOW", "GAIN", constants.hpfGainOn));
        } else {
            commands.push(this.writeEq(targetKey, "LOW", "Q_OR_TYPE", constants.hpfOffMode));
            commands.push(this.writeEq(targetKey, "LOW", "FREQ", constants.hpfOffFreq));
            commands.push(this.writeEq(targetKey, "LOW", "GAIN", constants.hpfGainOff));
        }
    }
    if (control === "lowNotchGain" || control === "lowNotchFreq") {
        var lowGain = state.lowNotchInit ? 12 : (state.lowNotchGain === undefined ? 0 : state.lowNotchGain);
        commands.push(this.writeEq(targetKey, "LO_MID", "Q", constants.notchQ));
        commands.push(this.writeEq(targetKey, "LO_MID", "FREQ", logHzToRaw(state.lowNotchFreq || 100, constants.lowNotchFreqRawRange)));
        commands.push(this.writeEq(targetKey, "LO_MID", "GAIN", auxGainDbToByte(lowGain)));
    }
    if (control === "highNotchGain" || control === "highNotchFreq") {
        var highGain = state.highNotchInit ? 12 : (state.highNotchGain === undefined ? 0 : state.highNotchGain);
        commands.push(this.writeEq(targetKey, "HI_MID", "Q", constants.notchQ));
        commands.push(this.writeEq(targetKey, "HI_MID", "FREQ", logHzToRaw(state.highNotchFreq || 800, constants.highNotchFreqRawRange)));
        commands.push(this.writeEq(targetKey, "HI_MID", "GAIN", auxGainDbToByte(highGain)));
    }
    if (control === "presence") {
        var presenceGain = state.presence === undefined ? value : state.presence;
        commands.push(this.writeEq(targetKey, "HIGH", "Q_OR_TYPE", constants.presenceQ));
        commands.push(this.writeEq(targetKey, "HIGH", "FREQ", constants.presenceFreq5000));
        commands.push(this.writeEq(targetKey, "HIGH", "GAIN", gainDbToByte(presenceGain)));
    }
    return [this.moduleIntent(module, "eq.auxMonitor", { target: target, control: control, value: value, state: state }, commands)];
};

LogicalEngine.prototype.effectReturnTargetKey = function(target) {
    if (!target) return "RTN1";
    var raw = String(target.midiKey || target.targetKey || target.id || target.masterId || "RTN1").toUpperCase();
    if (raw === "EFFECT1" || raw === "EFF1") return "RTN1";
    if (raw === "EFFECT2" || raw === "EFF2") return "RTN2";
    return raw;
};

LogicalEngine.prototype.setEffectReturnEqIntent = function(target, control, value, state) {
    state = state || {};
    var module = this.moduleFor("returnChannelPage", "tone");
    var targetKey = this.effectReturnTargetKey(target);
    var constants = this.effectReturnEqConstants;
    var commands = [];
    if (control === "hpf") {
        if (value === 100 || value === 175 || value === 250 || value === 500 || value === "100" || value === "175" || value === "250" || value === "500") {
            commands.push(this.writeEq(targetKey, "LOW", "Q_OR_TYPE", constants.hpfMode));
            commands.push(this.writeEq(targetKey, "LOW", "FREQ", constants.hpfFreq[value]));
            commands.push(this.writeEq(targetKey, "LOW", "GAIN", constants.hpfGainOn));
        } else {
            commands.push(this.writeEq(targetKey, "LOW", "Q_OR_TYPE", constants.hpfOffMode));
            commands.push(this.writeEq(targetKey, "LOW", "FREQ", constants.hpfOffFreq));
            commands.push(this.writeEq(targetKey, "LOW", "GAIN", constants.hpfGainOff));
        }
    }
    if (control === "low") {
        commands.push(this.writeEq(targetKey, "LO_MID", "Q", constants.qOne));
        commands.push(this.writeEq(targetKey, "LO_MID", "FREQ", constants.lowFixedFreq125));
        commands.push(this.writeEq(targetKey, "LO_MID", "GAIN", effectReturnGainDbToByte(value)));
    }
    if (control === "mid") {
        commands.push(this.writeEq(targetKey, "HI_MID", "Q", constants.qOne));
        commands.push(this.writeEq(targetKey, "HI_MID", "FREQ", constants.midFixedFreq2500));
        commands.push(this.writeEq(targetKey, "HI_MID", "GAIN", effectReturnGainDbToByte(value)));
    }
    if (control === "air") {
        commands.push(this.writeEq(targetKey, "HIGH", "Q_OR_TYPE", constants.qOne));
        commands.push(this.writeEq(targetKey, "HIGH", "FREQ", constants.airFixedFreq10000));
        commands.push(this.writeEq(targetKey, "HIGH", "GAIN", effectReturnGainDbToByte(value)));
    }
    return [this.moduleIntent(module, "eq.effectReturn", { target: target, control: control, value: value, state: state }, commands)];
};

LogicalEngine.prototype.getCompressorPreset = function(presetId) {
    var module = this.moduleFor("channelPage", "compressor");
    var presets = module.engineBehavior && module.engineBehavior.presets || {};
    var id = String(presetId || "COMP").toUpperCase();
    if (id === "OFF") return { id: "OFF", enabled: false };
    var preset = presets[id];
    if (!preset) preset = presets.COMP;
    return Object.assign({ id: id, enabled: true }, preset);
};

LogicalEngine.prototype.setCompressorIntent = function(target, presetId, amount, state) {
    var module = this.moduleFor("channelPage", "compressor");
    var preset = this.getCompressorPreset(presetId);
    if (!preset.enabled) {
        var offPayload = {
            target: target,
            preset: preset,
            values: { on: false },
            state: state || {},
            transport: "yamaha-dynamics"
        };
        return [this.moduleIntent(module, "compressor.musicalChannel", offPayload, [
            this.writeDynamicsBundle(target, offPayload.values)
        ])];
    }
    var behavior = module.engineBehavior || {};
    var presetCenter = behavior.presetCenter || 64;
    var potPosition = clamp(amount === undefined ? presetCenter : amount, 0, 127);
    var delta = potPosition - presetCenter;
    var thresholdRange = behavior.thresholdRange || [-54, 0];
    var outGainRange = behavior.outGainRange || [0, 18];
    var threshold = clamp(preset.threshold - delta * preset.thresholdFactor, thresholdRange[0], thresholdRange[1]);
    var outGain = clamp(preset.outGain + delta * preset.gainFactor, outGainRange[0], outGainRange[1]);
    var payload = {
        target: target,
        preset: preset,
        potPosition: potPosition,
        presetCenter: presetCenter,
        values: {
            on: true,
            threshold: Math.round(threshold * 10) / 10,
            outGain: Math.round(outGain * 10) / 10,
            ratio: preset.ratio,
            attack: preset.attack,
            release: preset.release,
            knee: preset.knee
        },
        state: state || {},
        transport: "yamaha-dynamics"
    };
    return [this.moduleIntent(module, "compressor.musicalChannel", payload, [
        this.writeDynamicsBundle(target, payload.values)
    ])];
};

LogicalEngine.prototype.setMasterCompressorIntent = function(target, state) {
    state = state || {};
    var module = this.moduleFor(target && target.masterId && target.masterId.indexOf("aux") === 0 ? "auxMasterPage" : "mixMasterPage", "compressor");
    var behavior = module.engineBehavior || {};
    var style = state.compStyle || state.style || null;
    if (!style) {
        var offPayload = {
            target: target,
            style: null,
            values: { on: false },
            state: state,
            transport: "yamaha-dynamics"
        };
        return [this.moduleIntent(module, "compressor.glueMaster", offPayload, [
            this.writeDynamicsBundle(target, offPayload.values)
        ])];
    }
    var ratioValues = ["1:1", "1.5:1", "2:1", "3:1", "4:1", "6:1", "10:1", "INF"];
    var defaults = behavior.styleDefaults && behavior.styleDefaults[style] || {};
    var ratioIndex = clamp(state.ratioIndex === undefined ? ratioValues.indexOf(defaults.ratio || "3:1") : state.ratioIndex, 0, ratioValues.length - 1);
    var values = {
        on: true,
        threshold: clamp(state.threshold === undefined ? -18 : state.threshold, -54, 0),
        ratio: ratioValues[ratioIndex] || defaults.ratio || "3:1",
        attack: defaults.attack === undefined ? 30 : defaults.attack,
        release: defaults.release === undefined ? 250 : defaults.release,
        knee: defaults.knee === undefined ? 2 : defaults.knee,
        outGain: clamp(state.outGain === undefined ? 0 : state.outGain, 0, 18)
    };
    var payload = {
        target: target,
        style: style,
        values: values,
        state: state,
        transport: "yamaha-dynamics"
    };
    return [this.moduleIntent(module, "compressor.glueMaster", payload, [
        this.writeDynamicsBundle(target, values)
    ])];
};

LogicalEngine.prototype.describeModules = function() {
    return this.moduleRegistry.describeAssignments(this.profile, this.userId);
};

module.exports = {
    LogicalEngine: LogicalEngine
};
