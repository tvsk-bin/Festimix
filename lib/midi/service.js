"use strict";

var profileRegistry = require("./profiles");
var yamaha01vSysex = require("./yamaha01vSysex");
var MappingEngine = require("./mappingEngine").MappingEngine;

function clamp7Bit(value) {
    var number = parseInt(value, 10);
    if (isNaN(number)) return 0;
    return Math.max(0, Math.min(127, number));
}

function parseMidiChannel(value) {
    var number = parseInt(value, 10);
    if (isNaN(number)) return 1;
    return Math.max(1, Math.min(16, number));
}

function MidiService(outPort, options) {
    options = options || {};
    this.outPort = outPort;
    this.channel = parseMidiChannel(options.channel || process.env.O1V_MIDI_CHANNEL || 1);
    this.profile = profileRegistry.getProfile(options.profile || process.env.O1V_MIDI_PROFILE || "yamaha01vDefault");
    this.mappingEngine = new MappingEngine();
}

MidiService.prototype.channelIndex = function() {
    return this.channel - 1;
};

MidiService.prototype.setProfile = function(profileId) {
    this.profile = profileRegistry.getProfile(profileId);
    return this.profile;
};

MidiService.prototype.setChannel = function(channel) {
    this.channel = parseMidiChannel(channel);
    return this.channel;
};

MidiService.prototype.sendCC = function(cc, value) {
    this.outPort.control(this.channelIndex(), parseInt(cc, 10), clamp7Bit(value));
};

MidiService.prototype.sendSysEx = function(bytes) {
    if (!Array.isArray(bytes)) {
        throw new Error("SysEx message must be an array of bytes.");
    }
    var packet = bytes.slice();
    console.log("Outgoing SysEx:", yamaha01vSysex.formatBytes(packet));
    var result = this.outPort.send(packet);
    if (result && typeof result.or === "function") {
        result.or(function(error) {
            console.error("SysEx send failed:", error);
        });
    }
    return packet;
};

MidiService.prototype.sendProgramChange = function(program) {
    this.outPort.program(this.channelIndex(), clamp7Bit(program));
};

MidiService.prototype.sendCommand = function(commandId) {
    var bytes = this.mappingEngine.commandPacket(commandId);
    this.sendSysEx(bytes);
    return { sent: true, commandId: commandId, sysex: yamaha01vSysex.formatBytes(bytes) };
};

MidiService.prototype.sendParameter = function(parameterId, value) {
    var message = this.mappingEngine.parameterMessage(parameterId, value);
    if (message.type === "sysex") {
        this.sendSysEx(message.bytes);
        return {
            sent: true,
            parameterId: parameterId,
            type: "sysex",
            value: clamp7Bit(value),
            sysex: yamaha01vSysex.formatBytes(message.bytes)
        };
    }
    this.sendCC(message.cc, value);
    return { sent: true, parameterId: parameterId, type: "cc", cc: message.cc, value: clamp7Bit(value) };
};

MidiService.prototype.sendParameterCc = function(parameterId, value) {
    var cc = this.mappingEngine.ccForParameter(parameterId);
    this.sendCC(cc, value);
    return { sent: true, parameterId: parameterId, type: "cc", cc: cc, value: clamp7Bit(value) };
};

MidiService.prototype.setChannelOn = function(channel, enabled) {
    var result = this.sendParameter("channelOn." + channel, enabled ? 127 : 0);
    result.action = "setChannelOn";
    result.channel = channel;
    result.enabled = !!enabled;
    return result;
};

MidiService.prototype.setChannelSolo = function(channel, enabled) {
    var packets = this.mappingEngine.buttonPackets("solo", channel, enabled);
    var self = this;
    var sent = packets.map(function(bytes) {
        self.sendSysEx(bytes);
        return yamaha01vSysex.formatBytes(bytes);
    });
    return { sent: true, action: "setChannelSolo", channel: channel, enabled: !!enabled, sysex: sent };
};

MidiService.prototype.setChannelPhase = function(channel, enabled) {
    var packets = this.mappingEngine.phasePackets(channel, enabled);
    var self = this;
    var sent = packets.map(function(bytes) {
        self.sendSysEx(bytes);
        return yamaha01vSysex.formatBytes(bytes);
    });
    return { sent: true, action: "setChannelPhase", channel: channel, enabled: !!enabled, sysex: sent };
};

MidiService.prototype.selectChannel = function(channel) {
    var packets = this.mappingEngine.selectChannelPackets(channel);
    var self = this;
    var sent = packets.map(function(bytes) {
        self.sendSysEx(bytes);
        return yamaha01vSysex.formatBytes(bytes);
    });
    return { sent: sent.length > 0, action: "selectChannel", channel: channel, sysex: sent };
};

MidiService.prototype.setMasterOn = function(master, enabled) {
    var result = this.sendParameter("masterOn." + master, enabled ? 127 : 0);
    result.action = "setMasterOn";
    result.master = master;
    result.enabled = !!enabled;
    return result;
};

MidiService.prototype.setMasterOnCc = function(master, enabled) {
    var result = this.sendParameterCc("masterOn." + master, enabled ? 127 : 0);
    result.action = "setMasterOnCc";
    result.master = master;
    result.enabled = !!enabled;
    return result;
};

MidiService.prototype.setMasterSolo = function(master, enabled) {
    var packets = this.mappingEngine.masterSoloPackets(master, enabled);
    var self = this;
    var sent = packets.map(function(bytes) {
        self.sendSysEx(bytes);
        return yamaha01vSysex.formatBytes(bytes);
    });
    return {
        sent: true,
        action: "setMasterSolo",
        master: master,
        enabled: !!enabled,
        sysex: sent
    };
};

MidiService.prototype.setAuxPrePostStartup = function(auxId, mode) {
    var packets = this.mappingEngine.auxPrePostPackets(auxId, mode);
    var self = this;
    var sent = packets.map(function(bytes) {
        self.sendSysEx(bytes);
        return yamaha01vSysex.formatBytes(bytes);
    });
    return {
        sent: true,
        action: "setAuxPrePostStartup",
        aux: auxId,
        mode: mode,
        sysex: sent
    };
};

MidiService.prototype.writeEqParameter = function(channel, band, parameter, value) {
    var bytes = this.mappingEngine.eqWritePacket(channel, band, parameter, value);
    this.sendSysEx(bytes);
    return {
        sent: true,
        action: "writeEqParameter",
        channel: channel,
        band: band,
        parameter: parameter,
        value: value,
        sysex: yamaha01vSysex.formatBytes(bytes)
    };
};

MidiService.prototype.writeDynamicsBundle = function(target, values) {
    var packets = this.mappingEngine.dynamicsBundlePackets(target, values || {});
    var self = this;
    var messages = packets.map(function(packet) {
        self.sendSysEx(packet.bytes);
        return {
            parameter: packet.parameter,
            value: packet.value,
            rawValue: packet.rawValue,
            sysex: yamaha01vSysex.formatBytes(packet.bytes)
        };
    });
    return {
        sent: true,
        action: "writeDynamicsBundle",
        target: target,
        values: values,
        authoritative: true,
        messages: messages
    };
};

MidiService.prototype.writeSimplifiedEqControl = function(channel, controlId, value, state) {
    var steps = this.mappingEngine.simplifiedEqBundle(channel, controlId, value, state || {});
    var self = this;
    var messages = steps.map(function(step) {
        self.sendSysEx(step.bytes);
        return {
            channel: step.channel,
            band: step.band,
            parameter: step.parameter,
            value: step.value,
            sysex: yamaha01vSysex.formatBytes(step.bytes)
        };
    });
    return {
        sent: true,
        action: "writeSimplifiedEqControl",
        channel: channel,
        controlId: controlId,
        value: value,
        messages: messages
    };
};

MidiService.prototype.sendIdentityRequest = function() {
    var bytes = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];
    this.sendSysEx(bytes);
    return {
        sent: true,
        parameter: "Universal SysEx Identity Request",
        sysex: yamaha01vSysex.formatBytes(bytes)
    };
};

MidiService.prototype.sendControl = function(control, value) {
    var cc = this.profile.controls[control];
    if (cc === null || cc === undefined) {
        return { sent: false, reason: "unsupported", control: control, profile: this.profile.id };
    }
    this.sendCC(cc, value);
    return { sent: true, control: control, cc: cc, value: clamp7Bit(value), profile: this.profile.id };
};

MidiService.prototype.sendLegacyUiControl = function(legacyId, value) {
    var control = profileRegistry.legacyCustom.controlFromCc[parseInt(legacyId, 10)];
    if (!control) {
        return { sent: false, reason: "unknown-legacy-control", legacyId: legacyId };
    }
    var result = this.sendControl(control, value);
    result.legacyId = parseInt(legacyId, 10);
    return result;
};

MidiService.prototype.sendCh1HiMidGain = function(gainDb) {
    var byteValue = yamaha01vSysex.eqGainDbToByte(gainDb);
    return this.writeEqParameter(1, "HI_MID", "GAIN", byteValue);
};

MidiService.prototype.sendCh2HiMidGainFixed = function() {
    var fixedValue = process.env.O1V_CH2_HIMID_GAIN_TEST_VALUE || "0x40";
    var value = String(fixedValue).toLowerCase().indexOf("0x") === 0 ? parseInt(fixedValue, 16) : parseInt(fixedValue, 10);
    return this.writeEqParameter(2, "HI_MID", "GAIN", value);
};

MidiService.prototype.sendAbsoluteParameter = function(address, value, label) {
    var bytes = yamaha01vSysex.buildParameterChange30(this.channelIndex(), address, value);
    this.sendSysEx(bytes);
    return {
        sent: true,
        parameter: label || "Yamaha 01V absolute parameter",
        address: address,
        value: value,
        sysex: yamaha01vSysex.formatBytes(bytes)
    };
};

MidiService.prototype.sendCh1PrototypeEqBand = function(band, gainDb) {
    var eqMap = {
        bass: {
            band: "LOW",
            freqValue: process.env.O1V_CH1_BASS_FREQ_VALUE,
            qValue: process.env.O1V_CH1_BASS_Q_VALUE,
            label: "CH1 BASS / LOW-MID"
        },
        mid: {
            band: "HI_MID",
            freqValue: process.env.O1V_CH1_MID_FREQ_VALUE,
            qValue: process.env.O1V_CH1_MID_Q_VALUE,
            label: "CH1 MID / HIGH-MID"
        },
        high: {
            band: "HIGH",
            freqValue: process.env.O1V_CH1_HIGH_FREQ_VALUE,
            qValue: process.env.O1V_CH1_HIGH_Q_VALUE,
            label: "CH1 HIGH"
        }
    };
    var config = eqMap[band];
    if (!config) {
        return { sent: false, reason: "unknown-eq-band", band: band };
    }

    var gainValue = yamaha01vSysex.eqGainDbToByte(gainDb);
    var controlId = band === "bass" ? "bassGain" : band === "mid" ? "midGain" : "highGain";
    var result = this.writeSimplifiedEqControl(1, controlId, gainValue, { midFrequency: 0, midGain: gainValue });

    return {
        sent: true,
        parameter: config.label,
        band: band,
        gainDb: parseFloat(gainDb),
        gainValue: gainValue,
        messages: result.messages
    };
};

MidiService.prototype.mapIncomingToLegacyUi = function(msg) {
    if (!msg || msg.length < 3) return null;
    var status = msg[0] & 0xf0;
    var channel = (msg[0] & 0x0f) + 1;
    if (status !== 0xb0 || channel !== this.channel) return null;

    var cc = msg[1];
    var value = msg[2];
    var control = this.profile.controlFromCc[cc];
    if (!control) return null;

    var legacyCc = profileRegistry.legacyCustom.controls[control];
    if (legacyCc === null || legacyCc === undefined) return null;

    return { legacyId: legacyCc, value: value, control: control, cc: cc };
};

module.exports = {
    MidiService: MidiService,
    clamp7Bit: clamp7Bit,
    parseMidiChannel: parseMidiChannel
};
