"use strict";

var dgram = require("dgram");

function pad4(length) {
    return (4 - (length % 4)) % 4;
}

function oscString(value) {
    var text = Buffer.from(String(value), "utf8");
    return Buffer.concat([text, Buffer.alloc(1 + pad4(text.length + 1))]);
}

function oscFloat(value) {
    var buffer = Buffer.alloc(4);
    var number = parseFloat(value);
    buffer.writeFloatBE(isNaN(number) ? 0 : number, 0);
    return buffer;
}

function clamp(value, min, max) {
    var number = parseFloat(value);
    if (isNaN(number)) number = min;
    return Math.max(min, Math.min(max, number));
}

function midiToNormalized(value) {
    return clamp(value, 0, 127) / 127;
}

function dbToNormalized(value) {
    return (clamp(value, -70, 6) + 70) / 76;
}

function gainDbToNormalized(value) {
    return (clamp(value, -20, 20) + 20) / 40;
}

function freqToNormalized(value, min, max) {
    var hz = clamp(value, min, max);
    return (Math.log(hz) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

function parseChannelNumber(channel) {
    var text = String(channel || "").toUpperCase();
    if (text === "CH13_14" || text === "13_14") return 13;
    if (text === "CH15_16" || text === "15_16") return 15;
    var match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function RmeTotalMixService(options) {
    options = options || {};
    this.profile = {
        id: options.profile || options.mixerProfileId || "rmeBabyfaceOsc",
        name: options.mixerProfileLabel || "RME Babyface OSC"
    };
    this.channel = 1;
    this.host = options.oscHost || process.env.RME_OSC_HOST || "127.0.0.1";
    this.port = parseInt(options.oscPort || process.env.RME_OSC_PORT || "7001", 10);
    this.maxChannels = 16;
    this.socket = dgram.createSocket("udp4");
    this.listeners = [];
    this.faders = {};
    this.solo = {};
    this.masterSolo = {};
    this.outputTargets = {
        stereo: 0,
        phones: 1,
        aux1: 2,
        aux2: 3,
        aux3: 4,
        aux4: 5,
        effect1: 0,
        effect2: 0
    };
    this.outputTargetCount = 6;
    this.lastBus = null;
    this.log("ready", "/__connect", [this.host + ":" + this.port]);
}

RmeTotalMixService.prototype.onLog = function(listener) {
    if (typeof listener === "function") this.listeners.push(listener);
};

RmeTotalMixService.prototype.log = function(action, address, args, extra) {
    var entry = Object.assign({
        time: new Date().toISOString(),
        transport: "rme-osc",
        action: action,
        address: address,
        args: args || [],
        target: this.host + ":" + this.port
    }, extra || {});
    console.log("OSC ->", entry.target, entry.address, JSON.stringify(entry.args));
    this.listeners.forEach(function(listener) {
        try { listener(entry); } catch (error) {}
    });
    return entry;
};

RmeTotalMixService.prototype.packet = function(address, args) {
    args = args || [];
    return Buffer.concat([
        oscString(address),
        oscString("," + args.map(function() { return "f"; }).join("")),
        Buffer.concat(args.map(oscFloat))
    ]);
};

RmeTotalMixService.prototype.sendOsc = function(address, args, action, extra) {
    args = args || [];
    var packet = this.packet(address, args);
    this.socket.send(packet, 0, packet.length, this.port, this.host);
    var entry = this.log(action || "osc", address, args, extra);
    return Object.assign({ sent: true }, entry);
};

RmeTotalMixService.prototype.trigger = function(address, action, extra) {
    return this.sendOsc(address, [1], action, extra);
};

RmeTotalMixService.prototype.bankStartForChannel = function(channelNumber) {
    var zeroBased = Math.max(0, Math.min(this.maxChannels - 1, channelNumber - 1));
    var bankStart = zeroBased < 8 ? 0 : 8;
    return bankStart / (this.maxChannels - 1);
};

RmeTotalMixService.prototype.slotForChannel = function(channelNumber) {
    return ((channelNumber - 1) % 8) + 1;
};

RmeTotalMixService.prototype.selectOutput = function(outputId) {
    var index = this.outputTargets[outputId] === undefined ? 0 : this.outputTargets[outputId];
    var normalized = index / Math.max(1, this.outputTargetCount - 1);
    this.lastBus = outputId;
    return this.sendOsc("/1/busOutput", [normalized], "selectBusOutput", { output: outputId, outputIndex: index });
};

RmeTotalMixService.prototype.selectChannelBank = function(channelNumber) {
    return this.sendOsc("/setBankStart", [this.bankStartForChannel(channelNumber)], "setBankStart", { channel: channelNumber });
};

RmeTotalMixService.prototype.setChannelVolumeOnOutput = function(channel, outputId, normalized, action) {
    var channelNumber = parseChannelNumber(channel);
    if (!channelNumber) {
        return { sent: false, transport: "rme-osc", reason: "unknown-channel", channel: channel };
    }
    this.selectOutput(outputId);
    this.selectChannelBank(channelNumber);
    return this.sendOsc("/1/volume" + this.slotForChannel(channelNumber), [clamp(normalized, 0, 1)], action || "setChannelVolume", {
        channel: channel,
        output: outputId
    });
};

RmeTotalMixService.prototype.sendCommand = function(commandId) {
    return this.trigger("/command/" + String(commandId).replace(/\./g, "/"), "sendCommand", { commandId: commandId });
};

RmeTotalMixService.prototype.sendParameter = function(parameterId, value) {
    var parts = String(parameterId || "").split(".");
    if (parts[0] === "channelFader") {
        this.faders[parts[1]] = midiToNormalized(value);
        return this.setChannelVolumeOnOutput(parts[1], "stereo", this.faders[parts[1]], "setMainFader");
    }
    if (parts[0] === "auxSend" && parts.length === 3) {
        return this.setChannelVolumeOnOutput(parts[2], parts[1].toLowerCase(), dbToNormalized(value), "setAuxSend");
    }
    if (parts[0] === "masterFader") {
        var outputId = parts[1] === "stereo" ? "stereo" : parts[1];
        this.selectOutput(outputId);
        return this.sendOsc("/1/masterVolume", [midiToNormalized(value)], "setMasterFader", { master: parts[1] });
    }
    if (parts[0] === "pan") {
        var channelNumber = parseChannelNumber(parts[1]);
        if (!channelNumber) return { sent: false, transport: "rme-osc", reason: "unknown-pan-channel", parameterId: parameterId };
        this.selectChannelBank(channelNumber);
        return this.sendOsc("/1/pan" + this.slotForChannel(channelNumber), [midiToNormalized(value)], "setPan", { channel: parts[1] });
    }
    return this.sendOsc("/unmapped/" + parts.join("/"), [midiToNormalized(value)], "unmappedParameter", { parameterId: parameterId, value: value });
};

RmeTotalMixService.prototype.sendParameterCc = function(parameterId, value) {
    return this.sendParameter(parameterId, value);
};

RmeTotalMixService.prototype.setChannelOn = function(channel, enabled) {
    return this.setChannelVolumeOnOutput(channel, "stereo", enabled ? (this.faders[channel] || 1) : 0, "setChannelOn");
};

RmeTotalMixService.prototype.setChannelSolo = function(channel, enabled) {
    this.solo[channel] = !!enabled;
    return this.setChannelVolumeOnOutput(channel, "phones", enabled ? 1 : 0, "setInternalSoloToPhones");
};

RmeTotalMixService.prototype.setChannelPhase = function(channel, enabled) {
    return this.trigger("/1/phase/" + channel + "/" + (enabled ? "1" : "0"), "setChannelPhase", { channel: channel, enabled: !!enabled });
};

RmeTotalMixService.prototype.setMasterOn = function(master, enabled) {
    this.selectOutput(master === "stereo" ? "stereo" : master);
    return this.sendOsc("/1/masterMute", [enabled ? 0 : 1], "setMasterOn", { master: master, enabled: !!enabled });
};

RmeTotalMixService.prototype.setMasterOnCc = function(master, enabled) {
    return this.setMasterOn(master, enabled);
};

RmeTotalMixService.prototype.setMasterSolo = function(master, enabled) {
    this.masterSolo[master] = !!enabled;
    this.selectOutput("phones");
    return this.sendOsc("/soloRoute/" + master, [enabled ? 1 : 0], "setMasterSoloToPhones", { master: master, enabled: !!enabled });
};

RmeTotalMixService.prototype.selectChannel = function(channel) {
    var channelNumber = parseChannelNumber(channel);
    if (channelNumber) this.selectChannelBank(channelNumber);
    return this.trigger("/1/select/" + this.slotForChannel(channelNumber || 1) + "/1", "selectChannel", { channel: channel });
};

RmeTotalMixService.prototype.setAuxPrePostStartup = function(auxId, mode) {
    return this.log("setAuxPrePostStartup", "/__not_applicable", [], { aux: auxId, mode: mode, sent: true });
};

RmeTotalMixService.prototype.writeEqParameter = function(channel, band, parameter, value) {
    var bandIndex = { LOW: 1, LO_MID: 1, HI_MID: 2, HIGH: 3 }[String(band).toUpperCase()] || 1;
    var parameterKey = String(parameter).toUpperCase();
    var address = parameterKey === "FREQ" ? "/2/eqFreq" + bandIndex :
        parameterKey === "Q" || parameterKey === "Q_OR_TYPE" ? "/2/eqQ" + bandIndex :
        "/2/eqGain" + bandIndex;
    var normalized = parameterKey === "FREQ" ? freqToNormalized(value, bandIndex === 1 ? 20 : 100, bandIndex === 3 ? 20000 : 8000) :
        parameterKey === "Q" || parameterKey === "Q_OR_TYPE" ? clamp(value, 0, 127) / 127 :
        gainDbToNormalized(value);
    this.selectChannel(channel);
    return this.sendOsc(address, [normalized], "writeEqParameter", { channel: channel, band: band, parameter: parameter, value: value });
};

RmeTotalMixService.prototype.writeDynamicsBundle = function(target, values) {
    return this.log("writeDynamicsBundle", "/__not_mapped_yet", [], { target: target, values: values || {}, sent: true });
};

RmeTotalMixService.prototype.writeSimplifiedEqControl = function(channel, controlId, value) {
    if (controlId === "hpfFreq") return this.writeEqParameter(channel, "LOW", "FREQ", value);
    if (controlId === "lowGain") return this.writeEqParameter(channel, "LOW", "GAIN", value);
    if (controlId === "midGain") return this.writeEqParameter(channel, "HI_MID", "GAIN", value);
    if (controlId === "highGain") return this.writeEqParameter(channel, "HIGH", "GAIN", value);
    return this.log("writeSimplifiedEqControl", "/__not_mapped_yet", [], { channel: channel, controlId: controlId, value: value, sent: true });
};

RmeTotalMixService.prototype.sendLegacyUiControl = function(legacyId, value) {
    return this.sendOsc("/legacy/" + legacyId, [midiToNormalized(value)], "sendLegacyUiControl", { legacyId: legacyId, value: value });
};

RmeTotalMixService.prototype.sendControl = function(control, value) {
    return this.sendOsc("/control/" + String(control).replace(/:/g, "/"), [midiToNormalized(value)], "sendControl", { control: control, value: value });
};

RmeTotalMixService.prototype.setProfile = function(profileId) {
    this.profile.id = profileId;
    this.profile.name = profileId;
    return this.profile;
};

RmeTotalMixService.prototype.setChannel = function(channel) {
    this.channel = parseInt(channel, 10) || 1;
    return this.channel;
};

RmeTotalMixService.prototype.mapIncomingToLegacyUi = function() { return null; };
RmeTotalMixService.prototype.sendIdentityRequest = function() { return this.trigger("/identity", "sendIdentityRequest"); };
RmeTotalMixService.prototype.sendCh1HiMidGain = function(gainDb) { return this.writeEqParameter(1, "HI_MID", "GAIN", gainDb); };
RmeTotalMixService.prototype.sendCh2HiMidGainFixed = function() { return this.writeEqParameter(2, "HI_MID", "GAIN", 0); };
RmeTotalMixService.prototype.sendCh1PrototypeEqBand = function(band, gainDb) { return this.writeEqParameter(1, band === "high" ? "HIGH" : band === "mid" ? "HI_MID" : "LOW", "GAIN", gainDb); };

module.exports = {
    RmeTotalMixService: RmeTotalMixService
};
