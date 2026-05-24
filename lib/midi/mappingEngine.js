"use strict";

var fs = require("fs");
var path = require("path");

function parseByte(value) {
    if (typeof value === "number") return value;
    var text = String(value).trim();
    if (text.toLowerCase().indexOf("0x") === 0) return parseInt(text, 16);
    if (/^[0-9a-fA-F]{2}$/.test(text)) return parseInt(text, 16);
    return parseInt(text, 10);
}

function parseNumber(value) {
    if (typeof value === "number") return value;
    var text = String(value).trim().toLowerCase();
    var sign = 1;
    if (text[0] === "-") {
        sign = -1;
        text = text.slice(1);
    } else if (text[0] === "+") {
        text = text.slice(1);
    }
    if (text.indexOf("0x") === 0) return sign * parseInt(text, 16);
    return sign * parseInt(text, 10);
}

function addressBytes(address) {
    var parsed = parseNumber(address);
    return [(parsed >> 7) & 0x7f, parsed & 0x7f];
}

function configuredAddressBytes(address) {
    if (address && Array.isArray(address.addressBytes)) {
        return address.addressBytes.map(parseByte);
    }
    return addressBytes(address);
}

function configuredPrefixBytes(config) {
    if (config && Array.isArray(config.prefix)) {
        return config.prefix.map(parseByte);
    }
    return null;
}

function clamp(value, min, max) {
    var number = parseFloat(value);
    if (isNaN(number)) number = min;
    return Math.max(min, Math.min(max, number));
}

function parseByteString(text) {
    var clean = String(text).trim();
    if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
        return clean.match(/../g).map(parseByte);
    }
    return clean.split(/\s+/).filter(Boolean).map(parseByte);
}

function observedFamilyPacket(family, value) {
    return String(family).trim().split(/\s+/).filter(Boolean).map(function(byte) {
        return byte === "data" ? parseByte(value) : parseByte(byte);
    });
}

function channelKey(key) {
    var text = String(key).toUpperCase();
    if (text === "RETURN1") return "RTN1";
    if (text === "RETURN2") return "RTN2";
    if (text === "EFFECT1") return "EFFECT1";
    if (text === "EFFECT2") return "EFFECT2";
    if (text === "FX1") return "FX1";
    if (text === "FX2") return "FX2";
    if (/^\d+$/.test(text)) return "CH" + text;
    if (/^\d+_\d+$/.test(text)) return "CH" + text;
    return text;
}

function masterKey(key) {
    var text = String(key).toUpperCase();
    if (text === "__ALL__" || text === "ALL" || text === "NONE") return "__ALL__";
    if (text === "ST" || text === "STEREO") return "STEREO";
    if (text === "FX1") return "EFFECT1";
    if (text === "FX2") return "EFFECT2";
    if (text === "EFFECT1") return "EFFECT1";
    if (text === "EFFECT2") return "EFFECT2";
    return text;
}

function loadMapping(mappingPath) {
    var v3 = path.join(__dirname, "..", "..", "yamaha01v.mapping_v3.json");
    var v2 = path.join(__dirname, "..", "..", "yamaha01v.mapping_v2.json");
    var target = mappingPath || (fs.existsSync(v3) ? v3 : (fs.existsSync(v2) ? v2 : path.join(__dirname, "..", "..", "yamaha01v.mapping.json")));
    return JSON.parse(fs.readFileSync(target, "utf8"));
}

function MappingEngine(mapping) {
    this.mapping = mapping || loadMapping();
}

MappingEngine.prototype.familyPacket = function(familyId, middleBytes) {
    if (this.mapping.sysex && familyId === "editBuffer7bitWrite") {
        var header = this.mapping.sysex.yamahaHeader.map(function(byte) {
            return byte === "1n" ? 0x10 : parseByte(byte);
        });
        return header.concat([0x04, 0x30]).concat(middleBytes).concat([0xf7]);
    }
    if (this.mapping.sysex && familyId === "editBufferWideWrite") {
        var wideHeader = this.mapping.sysex.yamahaHeader.map(function(byte) {
            return byte === "1n" ? 0x10 : parseByte(byte);
        });
        return wideHeader.concat([0x04, 0x00]).concat(middleBytes).concat([0xf7]);
    }
    if (this.mapping.sysex && familyId === "dynamicsOnOff") {
        var dynamicsHeader = this.mapping.sysex.yamahaHeader.map(function(byte) {
            return byte === "1n" ? 0x10 : parseByte(byte);
        });
        return dynamicsHeader.concat([0x04, 0x60]).concat(middleBytes).concat([0xf7]);
    }
    if (this.mapping.sysex && familyId === "keyRemote") {
        var keyHeader = this.mapping.sysex.yamahaHeader.map(function(byte) {
            return byte === "1n" ? 0x10 : parseByte(byte);
        });
        return keyHeader.concat([0x04, 0x43, 0x00]).concat(middleBytes).concat([0xf7]);
    }
    var family = this.mapping.sysexFamilies[familyId];
    if (!family) throw new Error("Unknown SysEx family: " + familyId);
    return family.prefix.map(parseByte).concat(middleBytes).concat(family.suffix.map(parseByte));
};

MappingEngine.prototype.commandPacket = function(commandId) {
    if (this.mapping.sysex && commandId === "scene.safeReset") {
        return parseByteString(this.mapping.sysex.sceneSafeReset);
    }
    var command = this.mapping.commands && this.mapping.commands[commandId];
    if (!command) throw new Error("Unknown command: " + commandId);
    if (command.type === "sysexRaw" && command.rawHex) return parseByteString(command.rawHex);
    if (command.type === "sysexRaw") return command.bytes.map(parseByte);
    if (command.type === "keyRemote") {
        return this.familyPacket("keyRemote", [parseByte(command.keyNo), parseByte(command.data)]);
    }
    throw new Error("Unsupported command type: " + command.type);
};

MappingEngine.prototype.buttonPacket = function(kind, channel, enabled) {
    var key = channelKey(channel);
    if (this.mapping.buttonSysex && kind === "select") {
        var select = this.mapping.buttonSysex.selectObserved && this.mapping.buttonSysex.selectObserved[key];
        if (select && select.bytes) return parseByteString(select.bytes);
    }
    var formula = this.mapping.buttonFormulas && this.mapping.buttonFormulas[kind];
    if (!formula) {
        var fallback = {
            on: { keyNoBase: 0, keyNoBankSize: 8, dataBase: 8 },
            solo: { keyNoBase: 2, keyNoBankSize: 8, dataBase: 8 },
            select: { keyNoBase: 4, keyNoBankSize: 8, dataBase: 8 }
        };
        formula = fallback[kind];
    }
    if (!formula) throw new Error("Unknown button formula: " + kind);
    var zeroBased = parseInt(channel, 10) - 1;
    if (isNaN(zeroBased)) throw new Error("No button mapping for " + kind + ": " + channel);
    var bank = Math.floor(zeroBased / formula.keyNoBankSize);
    var index = zeroBased % formula.keyNoBankSize;
    var keyNo = formula.keyNoBase + bank;
    var data = formula.dataBase + index;
    return this.familyPacket("keyRemote", [keyNo, data]);
};

MappingEngine.prototype.buttonPackets = function(kind, channel, enabled) {
    var key = channelKey(channel);
    if (this.mapping.buttonSysex && kind === "solo") {
        var soloRoot = this.mapping.buttonSysex.soloObserved;
        var solo = soloRoot && soloRoot[key];
        if (solo) {
            var index = enabled ? 1 : 0;
            var packets = [];
            if (soloRoot.familyA && solo.valuesA) packets.push(observedFamilyPacket(soloRoot.familyA, solo.valuesA[index]));
            if (soloRoot.familyB && solo.valuesB) packets.push(observedFamilyPacket(soloRoot.familyB, solo.valuesB[index]));
            if (packets.length) return packets;
        }
    }
    return [this.buttonPacket(kind, channel, enabled)];
};

MappingEngine.prototype.masterSoloPackets = function(master, enabled) {
    var config = this.mapping.masterSoloMonitorOutAssign;
    if (!config || !config.targets) throw new Error("Master solo monitor-out assign mapping is missing.");
    var key = masterKey(master);
    var order = config.order || Object.keys(config.targets);
    var packets = [];
    var self = this;

    function pushRaw(rawHex) {
        if (rawHex) packets.push(parseByteString(rawHex));
    }

    function pushMonitorTarget(target, isEnabled) {
        var entry = config.targets[target];
        if (!entry) return;
        pushRaw(isEnabled ? entry.on : entry.off);
    }

    function effectReturnFor(effectKey) {
        return config.effectReturns && config.effectReturns[effectKey];
    }

    function pushEffectReturns(selectedEffectKey) {
        ["EFFECT1", "EFFECT2"].forEach(function(effectKey) {
            var returnChannel = effectReturnFor(effectKey);
            if (returnChannel) {
                packets = packets.concat(self.buttonPackets("solo", returnChannel, selectedEffectKey === effectKey));
            }
        });
    }

    if (key === "__ALL__") {
        order.forEach(function(target) { pushMonitorTarget(target, false); });
        pushEffectReturns(null);
        return packets;
    }

    if (enabled) {
        order.forEach(function(target) { pushMonitorTarget(target, target === key); });
        pushEffectReturns(effectReturnFor(key) ? key : null);
        if (!packets.length) throw new Error("No master solo mapping for: " + master);
        return packets;
    }

    if (config.targets[key]) pushMonitorTarget(key, false);
    if (effectReturnFor(key)) {
        packets = packets.concat(this.buttonPackets("solo", effectReturnFor(key), false));
    }
    if (!packets.length) throw new Error("No master solo mapping for: " + master);
    return packets;
};

MappingEngine.prototype.auxPrePostPackets = function(auxId, mode) {
    var config = this.mapping.auxPrePostAssign;
    if (!config || !config.addressPairs) throw new Error("AUX pre/post mapping is missing.");
    var auxKey = String(auxId).toUpperCase();
    if (/^[1-4]$/.test(auxKey)) auxKey = "AUX" + auxKey;
    var selectedMode = String(mode || "pre").toLowerCase();
    if (selectedMode !== "pre") return [];
    var addresses = config.addressPairs[auxKey];
    if (!addresses) throw new Error("Unknown AUX pre/post bus: " + auxId);
    var channelCount = parseInt(config.channelCount || 16, 10);
    var pressBit = parseByte(config.pressBit || "0x08");
    var releaseBase = parseByte(config.releaseBase || "0x00");
    var header = this.mapping.sysex.yamahaHeader.map(function(byte) {
        return byte === "1n" ? 0x10 : parseByte(byte);
    });
    var packets = [];

    function rawAddressBytes(address) {
        var parsed = parseNumber(address);
        return [(parsed >> 8) & 0x7f, parsed & 0x7f];
    }

    for (var channel = 0; channel < channelCount; channel++) {
        var group = Math.floor(channel / 8);
        var index = channel % 8;
        var address = rawAddressBytes(addresses[group]);
        packets.push(header.concat([0x04, 0x40, address[0], address[1], pressBit + index, 0xf7]));
        packets.push(header.concat([0x04, 0x40, address[0], address[1], releaseBase + index, 0xf7]));
    }
    return packets;
};

MappingEngine.prototype.phasePackets = function(channel, enabled) {
    var phaseRoot = this.mapping.buttonSysex && this.mapping.buttonSysex.phaseObserved;
    var key = channelKey(channel);
    var entries = phaseRoot && phaseRoot.channels && phaseRoot.channels[key];
    if (!entries || !entries.length) throw new Error("No phase mapping for channel: " + channel);
    var families = phaseRoot.families || {};
    var index = enabled ? 1 : 0;
    return entries.map(function(entry) {
        var family = families[entry.family] || entry.family;
        if (!family || !entry.values) throw new Error("Invalid phase mapping for channel: " + channel);
        return observedFamilyPacket(family, entry.values[index]);
    });
};

MappingEngine.prototype.ccForParameter = function(parameterId) {
    var parts = String(parameterId).split(".");
    if (parts.length !== 2) throw new Error("Parameter id must be group.key: " + parameterId);
    if (this.mapping.ccMappings) {
        var groupMap = {
            channelFader: this.mapping.ccMappings.channelFader ? "channelFader" : "faders",
            masterFader: this.mapping.ccMappings.masterFader ? "masterFader" : "faders",
            channelOn: "channelOn",
            masterOn: "masterOn",
            pan: "pan",
            fx1Send: "fx1Send",
            fx2Send: "fx2Send"
        };
        var groupName = groupMap[parts[0]];
        if (parts[0] === "masterFader" && parts[1] === "effect1" && this.mapping.ccMappings.masterEffects) groupName = "masterEffects";
        if (parts[0] === "masterFader" && parts[1] === "effect2" && this.mapping.ccMappings.masterEffects) groupName = "masterEffects";
        if (groupName && this.mapping.ccMappings[groupName]) {
            var key = parts[0] === "channelFader" || parts[0] === "channelOn" || parts[0] === "pan" || parts[0] === "fx1Send" || parts[0] === "fx2Send" ? channelKey(parts[1]) : parts[1].toUpperCase();
            if (parts[0] === "masterFader" && parts[1] === "stereo") key = "STEREO";
            if (parts[0] === "masterFader" && parts[1].indexOf("aux") === 0) key = parts[1].toUpperCase();
            if (parts[0] === "masterFader" && parts[1] === "effect1") key = "FX1";
            if (parts[0] === "masterFader" && parts[1] === "effect2") key = "FX2";
            if (parts[0] === "masterFader" && parts[1] === "effect1" && this.mapping.ccMappings.masterFader) key = "EFFECT1";
            if (parts[0] === "masterFader" && parts[1] === "effect2" && this.mapping.ccMappings.masterFader) key = "EFFECT2";
            if (parts[0] === "masterOn" && parts[1] === "stereo") key = "STEREO";
            if (parts[0] === "masterOn" && parts[1].indexOf("aux") === 0) key = parts[1].toUpperCase();
            if (parts[0] === "masterOn" && parts[1] === "effect1") key = "EFFECT1";
            if (parts[0] === "masterOn" && parts[1] === "effect2") key = "EFFECT2";
            var mapped = this.mapping.ccMappings[groupName][key];
            if (mapped !== undefined && mapped !== null) return mapped;
        }
    }
    if (!this.mapping.ccDefault01v) throw new Error("Unknown CC parameter: " + parameterId);
    var group = this.mapping.ccDefault01v[parts[0]];
    if (!group) throw new Error("Unknown CC parameter group: " + parts[0]);
    var cc = group[parts[1]];
    if (cc === undefined || cc === null) throw new Error("Unknown CC parameter: " + parameterId);
    return cc;
};

MappingEngine.prototype.parameterMessage = function(parameterId, value) {
    var parts = String(parameterId).split(".");
    if (parts[0] === "auxSend" && parts.length === 3 && this.mapping.auxSends) {
        var aux = parts[1].toUpperCase();
        var key = channelKey(parts[2]);
        var address = this.mapping.auxSends.sends &&
            this.mapping.auxSends.sends[aux] &&
            this.mapping.auxSends.sends[aux][key];
        if (!address) throw new Error("Unknown AUX send parameter: " + parameterId);
        var addr = addressBytes(address);
        return {
            type: "sysex",
            parameterId: parameterId,
            bytes: this.familyPacket("editBuffer7bitWrite", [addr[0], addr[1], parseByte(value)])
        };
    }
    if (parts[0] === "masterFader" && this.mapping.sysexParameters && this.mapping.sysexParameters.masterFader) {
        var faderKey = masterKey(parts[1]);
        var faderAddress = this.mapping.sysexParameters.masterFader[faderKey];
        if (faderAddress) {
            var faderAddr = addressBytes(faderAddress);
            return {
                type: "sysex",
                parameterId: parameterId,
                bytes: this.familyPacket("editBuffer7bitWrite", [faderAddr[0], faderAddr[1], parseByte(value)])
            };
        }
    }
    if (parts[0] === "pan" && this.mapping.sysexParameters && this.mapping.sysexParameters.pan) {
        var panKey = channelKey(parts[1]);
        var panAddress = this.mapping.sysexParameters.pan[panKey];
        if (panAddress) {
            var panAddr = addressBytes(panAddress);
            return {
                type: "sysex",
                parameterId: parameterId,
                bytes: this.familyPacket("editBuffer7bitWrite", [panAddr[0], panAddr[1], parseByte(value)])
            };
        }
    }
    if (parts[0] === "attenuator" && parts.length === 3 &&
        this.mapping.sysexParameters &&
        this.mapping.sysexParameters.attenuator) {
        var attenuatorTarget = channelKey(parts[1]);
        var attenuatorSide = parts[2];
        var attenuatorAddress = this.mapping.sysexParameters.attenuator[attenuatorTarget] &&
            this.mapping.sysexParameters.attenuator[attenuatorTarget][attenuatorSide];
        if (!attenuatorAddress) throw new Error("Unknown attenuator parameter: " + parameterId);
        var attenuatorAddr = addressBytes(attenuatorAddress);
        return {
            type: "sysex",
            parameterId: parameterId,
            bytes: this.familyPacket("editBuffer7bitWrite", [attenuatorAddr[0], attenuatorAddr[1], parseByte(value)])
        };
    }
    if (parts[0] === "effectReturnSend" && parts.length === 3 &&
        this.mapping.sysexParameters &&
        this.mapping.sysexParameters.effectReturnSend) {
        var busKey = parts[1];
        var returnKeyDirect = parts[2];
        var effectReturnAddress = this.mapping.sysexParameters.effectReturnSend[busKey] &&
            this.mapping.sysexParameters.effectReturnSend[busKey][returnKeyDirect];
        if (!effectReturnAddress) throw new Error("Unknown effect return send parameter: " + parameterId);
        var effectReturnPrefix = configuredPrefixBytes(effectReturnAddress);
        if (effectReturnPrefix) {
            return {
                type: "sysex",
                parameterId: parameterId,
                bytes: this.mapping.sysex.yamahaHeader.map(function(byte) {
                    return byte === "1n" ? 0x10 : parseByte(byte);
                }).concat([0x04]).concat(effectReturnPrefix).concat([parseByte(value), 0xf7])
            };
        }
        var effectReturnAddr = configuredAddressBytes(effectReturnAddress);
        return {
            type: "sysex",
            parameterId: parameterId,
            bytes: this.familyPacket("editBuffer7bitWrite", [effectReturnAddr[0], effectReturnAddr[1], parseByte(value)])
        };
    }
    if ((parts[0] === "fx1Send" || parts[0] === "fx2Send") &&
        this.mapping.sysexParameters &&
        this.mapping.sysexParameters.effectReturnSend) {
        var returnKey = channelKey(parts[1]);
        var returnAddress = this.mapping.sysexParameters.effectReturnSend[parts[0]] &&
            this.mapping.sysexParameters.effectReturnSend[parts[0]][returnKey];
        if (returnAddress) {
            var returnPrefix = configuredPrefixBytes(returnAddress);
            if (returnPrefix) {
                return {
                    type: "sysex",
                    parameterId: parameterId,
                    bytes: this.mapping.sysex.yamahaHeader.map(function(byte) {
                        return byte === "1n" ? 0x10 : parseByte(byte);
                    }).concat([0x04]).concat(returnPrefix).concat([parseByte(value), 0xf7])
                };
            }
            var returnAddr = configuredAddressBytes(returnAddress);
            return {
                type: "sysex",
                parameterId: parameterId,
                bytes: this.familyPacket("editBuffer7bitWrite", [returnAddr[0], returnAddr[1], parseByte(value)])
            };
        }
    }
    if (parts[0] === "channelOn" && this.mapping.buttonSysex && this.mapping.buttonSysex.onOffObserved) {
        var onKey = channelKey(parts[1]);
        var observedOn = this.mapping.buttonSysex.onOffObserved[onKey];
        if (observedOn && observedOn.values) {
            return {
                type: "sysex",
                parameterId: parameterId,
                bytes: observedFamilyPacket(
                    this.mapping.buttonSysex.onOffObserved.family,
                    observedOn.values[parseByte(value) > 0 ? 1 : 0]
                )
            };
        }
    }
    if (parts[0] === "masterOn" && this.mapping.buttonSysex && this.mapping.buttonSysex.masterOnObserved) {
        var masterOnKey = masterKey(parts[1]);
        var masterOn = this.mapping.buttonSysex.masterOnObserved[masterOnKey];
        if (masterOn && masterOn.values) {
            return {
                type: "sysex",
                parameterId: parameterId,
                bytes: observedFamilyPacket(
                    this.mapping.buttonSysex.masterOnObserved.family,
                    masterOn.values[parseByte(value) > 0 ? 1 : 0]
                )
            };
        }
    }
    return {
        type: "cc",
        parameterId: parameterId,
        cc: this.ccForParameter(parameterId),
        value: parseByte(value)
    };
};

MappingEngine.prototype.eqAddress = function(channel, band, parameter) {
    var expandedKey = channelKey(channel);
    var expanded = this.mapping.eqExpandedCh1toCh8 && (
        this.mapping.eqExpandedCh1toCh8[String(channel)] ||
        this.mapping.eqExpandedCh1toCh8[expandedKey]
    );
    if (expanded && expanded[band]) {
        if (expanded[band][parameter]) return expanded[band][parameter];
        if (parameter === "Q_OR_TYPE" && expanded[band].Q) return expanded[band].Q;
        if (parameter === "Q" && expanded[band].Q_OR_TYPE) return expanded[band].Q_OR_TYPE;
    }
    var targetExpanded = this.mapping.eqExpandedTargets && (
        this.mapping.eqExpandedTargets[String(channel).toUpperCase()] ||
        this.mapping.eqExpandedTargets[expandedKey] ||
        this.mapping.eqExpandedTargets[masterKey(channel)]
    );
    if (targetExpanded && targetExpanded[band]) {
        if (targetExpanded[band][parameter]) return targetExpanded[band][parameter];
        if (parameter === "Q_OR_TYPE" && targetExpanded[band].Q) return targetExpanded[band].Q;
        if (parameter === "Q" && targetExpanded[band].Q_OR_TYPE) return targetExpanded[band].Q_OR_TYPE;
    }
    if (this.mapping.validatedEqAddresses) {
        var channelName = "CH" + channel;
        var channelAddresses = this.mapping.validatedEqAddresses[channelName];
        var paramName = parameter;
        if (parameter === "Q" && channelAddresses && channelAddresses[band] && channelAddresses[band].Q_OR_TYPE) {
            paramName = "Q_OR_TYPE";
        }
        if (parameter === "Q_OR_TYPE" && channelAddresses && channelAddresses[band] && channelAddresses[band].Q) {
            paramName = "Q";
        }
        if (channelAddresses && channelAddresses[band] && channelAddresses[band][paramName]) {
            return channelAddresses[band][paramName];
        }
    }
    if (this.mapping.eqEngine && this.mapping.eqEngine.formula) {
        var f = this.mapping.eqEngine.formula;
        if (Array.isArray(f.validatedChannels) && f.validatedChannels.indexOf(parseInt(channel, 10)) === -1) {
            throw new Error("No validated EQ address for channel: " + channel);
        }
        var idx = f.bands[band];
        if (idx === undefined) throw new Error("Unknown EQ band: " + band);
        var offset = f.parameterOffsets[parameter] || (parameter === "Q_OR_TYPE" ? f.parameterOffsets.Q : null);
        if (offset === null || offset === undefined) throw new Error("Unknown EQ parameter: " + parameter);
        return parseNumber(f.baseLowFreqCh1) +
            ((parseInt(channel, 10) - 1) * parseNumber(f.channelStride)) +
            (idx * parseNumber(f.bandStride)) +
            parseNumber(offset);
    }
    var channelMap = this.mapping.eqExpandedCh1toCh8[String(channel)];
    if (channelMap && channelMap[band] && channelMap[band][parameter]) {
        return channelMap[band][parameter];
    }

    var formula = this.mapping.eqAddressFormula;
    var bandIndex = formula.bands[band];
    if (bandIndex === undefined) throw new Error("Unknown EQ band: " + band);
    var gain = parseNumber(formula.baseLowGainCh1) +
        ((parseInt(channel, 10) - 1) * parseNumber(formula.channelStride)) +
        (bandIndex * parseNumber(formula.bandStride));
    if (parameter === "GAIN") return gain;
    if (parameter === "FREQ") return gain + parseNumber(formula.freqOffsetFromGain);
    if (parameter === "Q") return gain + parseNumber(formula.qOffsetFromGain);
    throw new Error("Unknown EQ parameter: " + parameter);
};

MappingEngine.prototype.eqWritePacket = function(channel, band, parameter, value) {
    var addr = addressBytes(this.eqAddress(channel, band, parameter));
    return this.familyPacket("editBuffer7bitWrite", [addr[0], addr[1], parseByte(value)]);
};

MappingEngine.prototype.dynamicsParameter = function(parameter) {
    var dynamics = this.mapping.dynamics || {};
    var parameters = dynamics.parameters || {};
    var config = parameters[parameter];
    if (!config) throw new Error("Unknown dynamics parameter: " + parameter);
    return config;
};

MappingEngine.prototype.dynamicsTargetKey = function(target) {
    if (!target) return "CH1";
    var raw = target.midiKey || target.masterId || target.id || target.channel || target;
    var key = channelKey(raw);
    if (key === "AUX1" || key === "AUX2" || key === "AUX3" || key === "AUX4") return key;
    if (key === "ST" || key === "STEREO") return "STEREO";
    if (key === "STEREO MASTER") return "STEREO";
    return key;
};

MappingEngine.prototype.dynamicsTargetOffset = function(target) {
    var key = this.dynamicsTargetKey(target);
    var addressing = (this.mapping.dynamics && this.mapping.dynamics.targetAddressing) || {};
    var offsets = addressing.targetOffsets || {};
    if (offsets[key] === undefined || offsets[key] === null) {
        throw new Error("Unknown dynamics target offset: " + key);
    }
    return parseNumber(offsets[key]);
};

MappingEngine.prototype.dynamicsOnOffAddress = function(target) {
    var key = this.dynamicsTargetKey(target);
    var groups = ((this.mapping.dynamics && this.mapping.dynamics.targetAddressing) || {}).onOffAddressGroups || [];
    for (var i = 0; i < groups.length; i += 1) {
        if ((groups[i].targets || []).indexOf(key) !== -1) return groups[i].address;
    }
    return null;
};

MappingEngine.prototype.dynamicsOnOffTargetIndex = function(target) {
    var key = this.dynamicsTargetKey(target);
    var groups = ((this.mapping.dynamics && this.mapping.dynamics.targetAddressing) || {}).onOffAddressGroups || [];
    for (var i = 0; i < groups.length; i += 1) {
        if ((groups[i].targets || []).indexOf(key) !== -1) {
            var indexes = groups[i].targetIndexes || {};
            if (indexes[key] === undefined || indexes[key] === null) {
                throw new Error("Missing dynamics ON/OFF target index: " + key);
            }
            return parseNumber(indexes[key]);
        }
    }
    throw new Error("Unknown dynamics ON/OFF target: " + key);
};

MappingEngine.prototype.dynamicsAddress = function(parameter, target) {
    var config = this.dynamicsParameter(parameter);
    if (parameter === "ON_OFF") {
        var onOffAddress = this.dynamicsOnOffAddress(target);
        if (onOffAddress) return parseNumber(onOffAddress);
    }
    return parseNumber(config.address) + this.dynamicsTargetOffset(target);
};

MappingEngine.prototype.dynamicsRawValue = function(parameter, value, target) {
    var config = this.dynamicsParameter(parameter);
    var encoding = config.encoding || "linear7bit";
    if (encoding === "targetIndexedBoolean7bit") {
        var enabled = value === true || value === "ON" || value === "on" || parseByte(value) > 0;
        return this.dynamicsOnOffTargetIndex(target) + (enabled ? parseNumber(config.raw.enabledOffset || "0x08") : 0);
    }
    if (encoding === "boolean7bit") {
        return value === true || value === "ON" || value === "on" || parseByte(value) > 0 ?
            parseNumber(config.raw.on) : parseNumber(config.raw.off);
    }
    if (encoding === "enum7bit" || encoding === "enumWide") {
        var rawMap = config.raw || {};
        var key = String(value);
        if (typeof value === "number" && parameter === "RATIO") key = value + ":1";
        if (String(value).toUpperCase() === "INF") key = "INF";
        if (String(value).toLowerCase() === "hard") key = "hard";
        if (rawMap[key] === undefined && rawMap[String(value).toUpperCase()] !== undefined) key = String(value).toUpperCase();
        if (rawMap[key] === undefined) throw new Error("Unknown dynamics " + parameter + " value: " + value);
        return parseNumber(rawMap[key]);
    }
    var raw = config.raw || {};
    var real = config.real || {};
    var rawMin = parseNumber(raw.min);
    var rawMax = parseNumber(raw.max);
    var realMin = parseFloat(real.min);
    var realMax = parseFloat(real.max);
    var clamped = clamp(value, realMin, realMax);
    if (encoding === "logWide" || encoding === "log7bit") {
        var safeMin = Math.max(0.0001, realMin);
        var safeMax = Math.max(safeMin, realMax);
        var logNormalized = (Math.log(clamped) - Math.log(safeMin)) / (Math.log(safeMax) - Math.log(safeMin));
        return Math.round(rawMin + logNormalized * (rawMax - rawMin));
    }
    var normalized = (clamped - realMin) / (realMax - realMin);
    return Math.round(rawMin + normalized * (rawMax - rawMin));
};

MappingEngine.prototype.dynamicsPacket = function(parameter, value, target) {
    var config = this.dynamicsParameter(parameter);
    var rawValue = this.dynamicsRawValue(parameter, value, target);
    var addr = addressBytes(this.dynamicsAddress(parameter, target));
    var encoding = config.encoding || "linear7bit";
    if (config.family === "dynamicsOnOff") {
        return {
            parameter: parameter,
            rawValue: rawValue,
            bytes: this.familyPacket("dynamicsOnOff", [addr[0], addr[1], rawValue & 0x7f])
        };
    }
    if (encoding === "linearWide" || encoding === "logWide" || encoding === "enumWide" || rawValue > 0x7f) {
        return {
            parameter: parameter,
            rawValue: rawValue,
            bytes: this.familyPacket("editBufferWideWrite", [addr[0], addr[1], (rawValue >> 7) & 0x7f, rawValue & 0x7f])
        };
    }
    return {
        parameter: parameter,
        rawValue: rawValue,
        bytes: this.familyPacket("editBuffer7bitWrite", [addr[0], addr[1], rawValue & 0x7f])
    };
};

MappingEngine.prototype.dynamicsBundlePackets = function(target, values) {
    values = values || {};
    var dynamics = this.mapping.dynamics || {};
    var order = dynamics.authoritativeBundleOrder || ["ON_OFF", "THRESHOLD", "RATIO", "ATTACK", "RELEASE", "KNEE", "OUT_GAIN"];
    var requested = {
        ON_OFF: values.on ? "ON" : "OFF",
        THRESHOLD: values.threshold,
        RATIO: values.ratio,
        ATTACK: values.attack,
        RELEASE: values.release,
        KNEE: values.knee,
        OUT_GAIN: values.outGain
    };
    var self = this;
    return order.filter(function(parameter) {
        return parameter === "ON_OFF" || requested[parameter] !== undefined;
    }).map(function(parameter) {
        var packet = self.dynamicsPacket(parameter, requested[parameter], target);
        packet.target = target;
        packet.value = requested[parameter];
        return packet;
    });
};

MappingEngine.prototype.resolveEqValue = function(token, inputValue, state) {
    if (token === "input") return parseByte(inputValue);
    if (typeof token === "number") return token;
    var text = String(token);
    if (text.indexOf("state.") === 0) {
        var stateKey = text.slice("state.".length);
        if (!state || state[stateKey] === undefined || state[stateKey] === null) {
            throw new Error("Missing EQ state value: " + stateKey);
        }
        return parseByte(state[stateKey]);
    }
    if (text.indexOf("defaults.") === 0) {
        var parts = text.split(".");
        var defaults = this.mapping.simplifiedEqModel.forcedDefaults;
        if (!defaults[parts[1]] || defaults[parts[1]][parts[2]] === undefined) {
            throw new Error("Missing EQ default: " + text);
        }
        return parseByte(defaults[parts[1]][parts[2]]);
    }
    return parseByte(token);
};

MappingEngine.prototype.simplifiedEqBundle = function(channel, controlId, inputValue, state) {
    var model = this.mapping.simplifiedEqModel;
    var bundle = model.controlBundles && model.controlBundles[controlId];
    if (!bundle) throw new Error("Unknown simplified EQ control: " + controlId);
    var self = this;
    return bundle.map(function(step) {
        var value = self.resolveEqValue(step.value, inputValue, state);
        return {
            channel: channel,
            band: step.band,
            parameter: step.parameter,
            value: value,
            bytes: self.eqWritePacket(channel, step.band, step.parameter, value)
        };
    });
};

module.exports = {
    MappingEngine: MappingEngine,
    loadMapping: loadMapping,
    parseByte: parseByte,
    parseNumber: parseNumber
};
