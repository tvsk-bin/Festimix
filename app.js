var express = require("express");
var app = express();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var JZZ = require("jzz");
var dgram = require("dgram");
var fs = require("fs");
var path = require("path");
var MidiService = require("./lib/midi/service").MidiService;
var profileRegistry = require("./lib/midi/profiles");
var LogicalEngine = require("./lib/engine/logicalEngine").LogicalEngine;
var formatSysExBytes = require("./lib/midi/yamaha01vSysex").formatBytes;
var AsioMeterBridge = require("./lib/audio/asioMeterBridge").AsioMeterBridge;
var mediaControl = require("./lib/media/mediaControl");

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});
var outPort;
app.use("/assets", express.static(__dirname + '/assets'));

function sendMediaResponse(res, error, payload) {
    if (error) {
        res.status(500).json({
            ok: false,
            supported: mediaControl.isSupported(),
            error: error.message
        });
        return;
    }
    res.json(Object.assign({ ok: true }, payload || {}));
}

app.get("/api/media/status", function(req, res) {
    mediaControl.getStatus(function(error, status) {
        sendMediaResponse(res, error, status);
    });
});

app.post("/api/media/playpause", function(req, res) {
    mediaControl.playPause(function(error, status) {
        sendMediaResponse(res, error, status);
    });
});

app.post("/api/media/next", function(req, res) {
    mediaControl.next(function(error, status) {
        sendMediaResponse(res, error, status);
    });
});

app.post("/api/media/previous", function(req, res) {
    mediaControl.previous(function(error, status) {
        sendMediaResponse(res, error, status);
    });
});

app.post("/api/media/launch-spotify", function(req, res) {
    mediaControl.launchSpotify(function(error, status) {
        sendMediaResponse(res, error, status);
    });
});

var sceneStorePath = path.join(__dirname, "data", "mix-setups.json");
var latestAudioMeterFrame = null;

function clamp(value, min, max) {
    var numeric = parseFloat(value);
    if (!isFinite(numeric)) numeric = 0;
    return Math.max(min, Math.min(max, numeric));
}

function oscStringBuffer(value) {
    var data = Buffer.from(String(value || ""), "utf8");
    var paddedLength = Math.ceil((data.length + 1) / 4) * 4;
    var buffer = Buffer.alloc(paddedLength);
    data.copy(buffer);
    return buffer;
}

function oscIntBuffer(value) {
    var buffer = Buffer.alloc(4);
    buffer.writeInt32BE(Math.round(parseFloat(value) || 0), 0);
    return buffer;
}

function oscFloatBuffer(value) {
    var buffer = Buffer.alloc(4);
    buffer.writeFloatBE(parseFloat(value) || 0, 0);
    return buffer;
}

function oscMessageBuffer(address, args) {
    var types = ",";
    var values = [];
    (args || []).forEach(function(arg) {
        if (typeof arg === "string") {
            types += "s";
            values.push(oscStringBuffer(arg));
        } else if (arg && typeof arg === "object" && arg.type === "int") {
            types += "i";
            values.push(oscIntBuffer(arg.value));
        } else {
            types += "f";
            values.push(oscFloatBuffer(arg));
        }
    });
    return Buffer.concat([oscStringBuffer(address), oscStringBuffer(types)].concat(values));
}

function readOscString(buffer, offset) {
    var end = offset;
    while (end < buffer.length && buffer[end] !== 0) end++;
    var value = buffer.slice(offset, end).toString("utf8");
    var next = Math.ceil((end + 1) / 4) * 4;
    return { value: value, offset: next };
}

function parseOscMessage(buffer) {
    var address = readOscString(buffer, 0);
    if (!address.value || address.value[0] !== "/") return null;
    if (address.value === "#bundle") return null;
    var typeTags = readOscString(buffer, address.offset);
    var tags = typeTags.value && typeTags.value[0] === "," ? typeTags.value.slice(1) : "";
    var offset = typeTags.offset;
    var args = [];
    for (var i = 0; i < tags.length; i++) {
        var tag = tags[i];
        if (tag === "f") {
            args.push(buffer.readFloatBE(offset));
            offset += 4;
        } else if (tag === "i") {
            args.push(buffer.readInt32BE(offset));
            offset += 4;
        } else if (tag === "s") {
            var parsed = readOscString(buffer, offset);
            args.push(parsed.value);
            offset = parsed.offset;
        }
    }
    return { address: address.value, args: args, types: tags };
}

function parseOscPacket(buffer) {
    var header = readOscString(buffer, 0);
    if (!header.value || (header.value[0] !== "/" && header.value !== "#bundle")) return [];
    if (header.value !== "#bundle") {
        var message = parseOscMessage(buffer);
        return message ? [message] : [];
    }
    var offset = 16;
    var messages = [];
    while (offset + 4 <= buffer.length) {
        var size = buffer.readInt32BE(offset);
        offset += 4;
        if (size <= 0 || offset + size > buffer.length) break;
        messages = messages.concat(parseOscPacket(buffer.slice(offset, offset + size)));
        offset += size;
    }
    return messages;
}

function channelNumberFromKey(channel) {
    if (typeof channel === "number") return channel;
    var text = String(channel || "").trim().toUpperCase();
    var match = text.match(/^CH(\d+)$/) || text.match(/^(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
}

function channelPairFromKey(channel) {
    var text = String(channel || "").trim().toUpperCase().replace(/^CH/, "");
    var match = text.match(/^(\d+)_(\d+)$/);
    return match ? [match[1], match[2]] : null;
}

function midiToUnit(value) {
    return clamp(value, 0, 127) / 127;
}

function unitToMidi(value) {
    return Math.round(clamp(value, 0, 1) * 127);
}

function gainToUnit(value) {
    return clamp(value, 0, 65) / 65;
}

function dbToUnit(value) {
    var db = clamp(value, -70, 6);
    return (db + 70) / 76;
}

function toggleToInt(value) {
    if (typeof value === "boolean") return value ? 1 : 0;
    return parseFloat(value) > 0 ? 1 : 0;
}

function inputLevelModeToRefLevel(value) {
    var mode = Math.max(0, Math.min(2, parseInt(value, 10) || 0));
    if (mode === 1) return 0.0;
    return 1.0;
}

function refLevelToInputLevelMode(value) {
    var unit = parseFloat(value) || 0;
    if (unit >= 0.5) return 2;
    return 1;
}

function effectFrequencyValue(value) {
    var text = String(value || "").trim().toLowerCase();
    var numeric = parseFloat(text) || 0;
    if (text.indexOf("k") >= 0) numeric *= 1000;
    return clamp(numeric, 20, 20000) / 20000;
}

function effectLinearValue(value, min, max) {
    return (clamp(value, min, max) - min) / (max - min);
}

function effectHzValue(value, min, max) {
    var text = String(value || "").trim().toLowerCase();
    if (text === "off") return 0;
    var numeric = parseFloat(text) || 0;
    if (text.indexOf("k") >= 0) numeric *= 1000;
    numeric = clamp(numeric, min, max);
    return Math.log(numeric / min) / Math.log(max / min);
}

function effectVolumeValue(value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text || text === "-inf" || text === "-infinity" || text === "inf" || text === "off") return 0;
    var db = parseFloat(text);
    if (!isFinite(db)) return 0;
    return effectLinearValue(db, -64.5, 6);
}

function echoDelayValue(value) {
    var text = String(value || "").trim();
    var first = text.split("/")[0];
    var numeric = parseFloat(first);
    if (!isFinite(numeric)) numeric = parseFloat(text) || 0;
    if (numeric > 2 && numeric <= 200) numeric = numeric / 100;
    var target = clamp(numeric, 0, 2);
    if (target <= 0.12) return 0;
    var a = 2.863026109875627;
    var b = 1.3364467506795163;
    var c = 0.1160200971913351;
    var discriminant = b * b - 4 * a * (c - target);
    if (discriminant < 0) return 0;
    return clamp((-b + Math.sqrt(discriminant)) / (2 * a), 0, 1);
}

function echoHighCutValue(value) {
    var text = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
    var values = ["off", "16k", "12k", "8k", "4k", "2k"];
    var index = values.indexOf(text);
    if (index < 0) {
        var numeric = parseFloat(text) || 0;
        if (text.indexOf("k") >= 0) numeric *= 1000;
        var hzValues = [0, 16000, 12000, 8000, 4000, 2000];
        index = hzValues.indexOf(Math.round(numeric));
    }
    if (index < 0) index = 0;
    return values.length <= 1 ? 0 : index / (values.length - 1);
}

function TotalMixOscService(options) {
    options = options || {};
    this.profile = profileRegistry.getProfile(options.profile || "rmeBabyfaceProFs12");
    this.channel = parseInt(options.channel || 1, 10) || 1;
    this.workspace = options.workspace || {};
    this.oscHost = options.oscHost || process.env.TOTALMIX_OSC_HOST || process.env.RME_OSC_HOST || "127.0.0.1";
    this.oscPort = parseInt(options.oscPort || process.env.TOTALMIX_OSC_PORT || process.env.RME_OSC_PORT || 7001, 10) || 7001;
    this.oscLocalPort = parseInt(options.oscLocalPort || process.env.TOTALMIX_OSC_LOCAL_PORT || process.env.RME_OSC_LOCAL_PORT || 9001, 10) || 9001;
    this.currentBankStart = 0;
    this.currentSubmixMode = "mix";
    this.currentBusSection = "input";
    this.selectedChannelNumber = 1;
    this.selectedInputTrackNumber = 1;
    this.inputBusRestoreTimer = null;
    this.oscStateDuplex = String(process.env.FESTIMIX_OSC_STATE_DUPLEX || "").trim() === "1";
    this.startupSnapshotAddress = process.env.FESTIMIX_OSC_STARTUP_SNAPSHOT_ADDRESS || "/3/snapshot1";
    this.onIncoming = null;
    this.onMeterFrame = null;
    this.oscMeters = {};
    this.oscMeterFrame = { left: -60, right: -60 };
    this.oscMeterLeftIndex = ((options.meterAudioChannels && parseInt(options.meterAudioChannels.left, 10)) || 0) + 1;
    this.oscMeterRightIndex = this.oscMeterLeftIndex;
    this.socket = dgram.createSocket("udp4");
    this.bindIncomingOsc();
    if (this.profile && this.profile.id === "rmeBabyfaceProFs12") {
        var self = this;
        setTimeout(function() { self.recallStartupSnapshot(); }, 250);
        setTimeout(function() { self.initializeBabyfaceEqState(); }, 900);
    }
}

TotalMixOscService.prototype.setProfile = function(profileId) {
    this.profile = profileRegistry.getProfile(profileId);
    return this.profile;
};

TotalMixOscService.prototype.setChannel = function(channel) {
    this.channel = parseInt(channel, 10) || 1;
    return this.channel;
};

TotalMixOscService.prototype.pending = function(action, payload) {
    return Object.assign({
        sent: false,
        reason: "osc-mapping-pending",
        integration: "osc",
        profile: this.profile.id,
        action: action
    }, payload || {});
};

TotalMixOscService.prototype.oscAddress = function(page, control) {
    return "/" + page + "/" + control;
};

TotalMixOscService.prototype.channelTarget = function(channel) {
    var number = channelNumberFromKey(channel);
    if (!number) return null;
    if (number >= 13 && number <= 22) {
        return {
            number: number,
            singleIndex: (number - 13) * 2,
            page2Index: number - 13,
            bankStart: 0,
            page: 1,
            index: number - 12,
            bus: "playback"
        };
    }
    var isUpperInputBank = number > 8;
    var bankStart = isUpperInputBank ? 8 : 0;
    return {
        number: number,
        singleIndex: (number - 1) * 2,
        page2Index: number - 1,
        bankStart: bankStart,
        page: 1,
        index: isUpperInputBank ? number - 4 : number,
        bus: "input"
    };
};

TotalMixOscService.prototype.selectBusSection = function(section) {
    var next = section || "input";
    if (this.currentBusSection === next) return null;
    this.currentBusSection = next;
    if (next === "playback") return this.sendOsc("/1/busPlayback", [1.0], { action: "selectBusPlayback" });
    if (next === "output") return this.sendOsc("/1/busOutput", [1.0], { action: "selectBusOutput" });
    return this.sendOsc("/1/busInput", [1.0], { action: "selectBusInput" });
};

TotalMixOscService.prototype.oscControlLog = function(direction, controlId, detail) {
    if (process.env.FESTIMIX_OSC_CONTROL_DEBUG !== "1") return;
    console.log("OSC CONTROL", direction, controlId, JSON.stringify(detail || {}));
};

TotalMixOscService.prototype.sendBabyfaceGain = function(channelKey, value) {
    var channelNumber = channelNumberFromKey(channelKey);
    var unit = this.parameterValue("gain." + channelKey, value);
    if (channelNumber >= 1 && channelNumber <= 4) {
        var payload = { action: "sendParameter", parameterId: "gain." + channelKey, value: value, oscRole: "registry-gain-selected-track-page2" };
        this.oscControlLog("WRITE", "gain." + channelKey, { type: "continuous-local", path: "track-plus-page2-gain", value: value, unit: unit });
        if (this.currentBusSection !== "input" || this.selectedInputTrackNumber !== channelNumber) {
            this.selectBusSection("input");
            this.sendOsc("/1/track" + channelNumber, [1.0], { action: "registrySelectGainTrack", parameterId: "gain." + channelKey, channel: channelNumber });
            this.selectedInputTrackNumber = channelNumber;
            this.selectedChannelNumber = channelNumber;
        }
        return this.sendOsc("/2/gain", [unit], payload);
    }
    return this.pending("sendParameter", { parameterId: "gain." + channelKey, value: value, reason: "gain-only-on-analog-1-4" });
};

TotalMixOscService.prototype.sendBabyfacePad = function(channelKey, value) {
    var channelNumber = channelNumberFromKey(channelKey);
    if (channelNumber < 1 || channelNumber > 2) {
        return this.pending("sendParameter", { parameterId: "pad." + channelKey, value: value, reason: "pad-only-on-analog-1-2" });
    }
    this.oscControlLog("WRITE", "pad." + channelKey, { type: "pulse-toggle", selectedTrack: channelNumber, requested: !!toggleToInt(value) });
    this.selectBusSection("input");
    this.sendOsc("/1/track" + channelNumber, [1.0], { action: "registrySelectPadTrack", parameterId: "pad." + channelKey, channel: channelNumber });
    this.selectedInputTrackNumber = channelNumber;
    this.selectedChannelNumber = channelNumber;
    return this.sendOsc("/2/pad", [1.0], { action: "sendParameter", parameterId: "pad." + channelKey, value: value, oscRole: "registry-pad-toggle-pulse" });
};

TotalMixOscService.prototype.sendBabyfaceInputLevel = function(channelKey, value) {
    var channelNumber = channelNumberFromKey(channelKey);
    if (channelNumber < 3 || channelNumber > 4) {
        return this.pending("sendParameter", { parameterId: "inputLevel." + channelKey, value: value, reason: "input-level-only-on-analog-3-4" });
    }
    var mode = Math.max(0, Math.min(2, parseInt(value, 10) || 0));
    var payload = { action: "sendParameter", parameterId: "inputLevel." + channelKey, value: mode, oscRole: "registry-input-level-selected-track" };
    var self = this;
    this.oscControlLog("WRITE", "inputLevel." + channelKey, { type: "pulse-toggle", selectedTrack: channelNumber, mode: mode });
    this.selectBusSection("input");
    this.sendOsc("/1/track" + channelNumber, [1.0], { action: "registrySelectInputLevelTrack", parameterId: "inputLevel." + channelKey, channel: channelNumber });
    this.selectedInputTrackNumber = channelNumber;
    this.selectedChannelNumber = channelNumber;
    setTimeout(function() {
        if (mode === 0) {
            self.sendOsc("/2/refLevel", [2.0], Object.assign({}, payload, { oscRole: "registry-input-level-boost-reflevel2" }));
            return;
        }
        self.sendOsc("/2/pad", [0.0], { action: "registryClearInputLevelPad", parameterId: "inputLevel." + channelKey, channel: channelNumber });
        self.sendOsc("/2/inst", [0.0], { action: "registryClearInputLevelInst", parameterId: "inputLevel." + channelKey, channel: channelNumber });
        self.sendOsc("/2/refLevel", [inputLevelModeToRefLevel(mode)], payload);
    }, 45);
    return Object.assign({
        sent: true,
        integration: "osc",
        profile: this.profile.id,
        address: "/2/refLevel",
        args: [mode === 0 ? 2.0 : inputLevelModeToRefLevel(mode)],
        delayed: true
    }, payload);
};

TotalMixOscService.prototype.lowcutFreqUnit = function(value) {
    var hz = parseInt(value, 10) || 0;
    if (hz <= 0) return 0;
    if (hz <= 75) return 0.38;
    if (hz <= 100) return 0.52;
    if (hz <= 175) return 0.72;
    return 0.88;
};

TotalMixOscService.prototype.sendBabyfaceHpf = function(channelKey, value) {
    var channelNumber = channelNumberFromKey(channelKey);
    if (channelNumber < 1 || channelNumber > 12) {
        return this.pending("sendParameter", { parameterId: "hpf." + channelKey, value: value, reason: "hpf-only-on-input-1-12" });
    }

    var enabled = value !== null && value !== undefined && !!parseInt(value, 10);

    if (!this.hpfState) this.hpfState = {};
    var wasEnabled = !!this.hpfState[channelKey];

    this.oscControlLog("WRITE", "hpf." + channelKey, {
        type: "toggle-with-frequency-stateful",
        selectedTrack: channelNumber,
        wasEnabled: wasEnabled,
        enabled: enabled,
        value: value
    });

    this.selectBusSection("input");

    if (this.selectedInputTrackNumber !== channelNumber) {
        this.sendOsc("/1/track" + channelNumber, [1.0], {
            action: "registrySelectHpfTrack",
            parameterId: "hpf." + channelKey,
            channel: channelNumber
        });
        this.selectedInputTrackNumber = channelNumber;
        this.selectedChannelNumber = channelNumber;
    }

    if (wasEnabled !== enabled) {
        this.sendOsc("/2/lowcutEnable", [1.0], {
            action: "sendParameter",
            parameterId: "hpf." + channelKey,
            value: value,
            oscRole: "registry-hpf-enable-toggle"
        });
    }

    if (enabled) {
        this.sendOsc("/2/lowcutGrade", [0.6667], {
            action: "sendParameter",
            parameterId: "hpf." + channelKey,
            value: value,
            oscRole: "registry-hpf-grade-18db"
        });

        this.sendOsc("/2/lowcutFreq", [this.lowcutFreqUnit(value)], {
            action: "sendParameter",
            parameterId: "hpf." + channelKey,
            value: value,
            oscRole: "registry-hpf-frequency"
        });
    }

    this.hpfState[channelKey] = enabled;

    return {
        sent: true,
        integration: "osc",
        profile: this.profile.id,
        action: "sendParameter",
        parameterId: "hpf." + channelKey,
        value: value,
        oscRole: "registry-hpf"
    };
};

TotalMixOscService.prototype.sendBabyfaceEffectOn = function(kind, value) {
    var address = kind === "echo" ? "/3/echoEnable" : "/3/reverbEnable";
    var enabled = !!toggleToInt(value);
    if (!this.babyfaceEffectEnableState) this.babyfaceEffectEnableState = {};
    var hasKnownState = Object.prototype.hasOwnProperty.call(this.babyfaceEffectEnableState, kind);
    var wasEnabled = !!this.babyfaceEffectEnableState[kind];
    if (hasKnownState && wasEnabled === enabled) {
        return {
            sent: true,
            integration: "osc",
            profile: this.profile.id,
            action: "sendParameter",
            parameterId: "effect." + kind + ".on",
            value: value,
            enabled: enabled,
            oscRole: "registry-effect-enable-state-unchanged"
        };
    }
    this.babyfaceEffectEnableState[kind] = enabled;
    this.oscControlLog("WRITE", "effect." + kind + ".on", { type: "stateful-toggle", address: address, enabled: enabled });
    return this.sendOsc(address, [1.0], { action: "sendParameter", parameterId: "effect." + kind + ".on", value: value, enabled: enabled, oscRole: "registry-effect-enable-toggle" });
};

TotalMixOscService.prototype.sendBabyfaceEffectReturn = function(bus, value) {
    var normalizedBus = String(bus || "master").toLowerCase();
    var submix = normalizedBus === "master" ? "mix" : normalizedBus;
    var output = normalizedBus === "master" ? "stereo" : normalizedBus;
    var unit = midiToUnit(value);
    this.oscControlLog("WRITE", "effectReturnSend." + normalizedBus + ".effRtn1", { type: "continuous-live", submix: submix, output: output, value: value, unit: unit });
    this.currentSubmixMode = submix;
    this.selectOutputChannel(output);
    return this.sendOsc("/2/reverbReturn", [unit], {
        action: "sendParameter",
        parameterId: "effectReturnSend." + normalizedBus + ".effRtn1",
        value: value,
        oscRole: "registry-effect-return-selected-submix"
    });
};

TotalMixOscService.prototype.sendBabyfaceRegisteredParameter = function(parameterId, value) {
    var id = String(parameterId || "");
    var parts = id.split(".");
    if (parts[0] === "gain") return this.sendBabyfaceGain(parts[1], value);
    if (parts[0] === "hpf") return this.sendBabyfaceHpf(parts[1], value);
    if (parts[0] === "pad") return this.sendBabyfacePad(parts[1], value);
    if (parts[0] === "inputLevel") return this.sendBabyfaceInputLevel(parts[1], value);
    if (parts[0] === "effect" && (parts[1] === "reverb" || parts[1] === "echo") && parts[2] === "on") {
        return this.sendBabyfaceEffectOn(parts[1], value);
    }
    if (parts[0] === "effectReturnSend" && parts[2] === "effRtn1") {
        return this.sendBabyfaceEffectReturn(parts[1], value);
    }
    return null;
};

TotalMixOscService.prototype.bindIncomingOsc = function() {
    var self = this;
    this.socket.on("message", function(buffer) {
        parseOscPacket(buffer).forEach(function(message) {
            if (!message) return;
            console.log("OSC <-", message.address, JSON.stringify(message.args));
            if (/^\/\d+\/level\d+(?:Left|Right)$/.test(message.address) || /^\/2\/level(?:Left|Right)$/.test(message.address)) {
                self.mapIncomingToUi(message);
                return;
            }
            if (!self.oscStateDuplex) return;
            self.mapIncomingToUi(message).forEach(function(event) {
                if (event && self.onIncoming) self.onIncoming(event);
            });
        });
    });
    this.socket.on("error", function(error) {
        if (error && error.code === "EADDRINUSE") {
            console.warn("OSC receive port is already in use:", self.oscLocalPort, "- close the previous Festimix server or change TOTALMIX_OSC_LOCAL_PORT.");
            return;
        }
        console.warn("OSC socket error:", error.message);
    });
    this.socket.bind(this.oscLocalPort, function() {
        console.log("OSC listen:", self.oscLocalPort);
    });
};

TotalMixOscService.prototype.sendOsc = function(address, args, payload) {
    var self = this;
    var message = oscMessageBuffer(address, args || []);
    this.socket.send(message, 0, message.length, this.oscPort, this.oscHost, function(error) {
        if (error) console.warn("OSC send failed", address, error.message);
    });
    console.log("OSC ->", this.oscHost + ":" + this.oscPort, address, JSON.stringify(args || []));
    return Object.assign({
        sent: true,
        integration: "osc",
        profile: self.profile.id,
        address: address,
        args: args || []
    }, payload || {});
};

TotalMixOscService.prototype.ensureBank = function(target) {
    if (!target) return null;
    this.selectBusSection(target.bus || "input");
    if (this.currentBankStart === target.bankStart) return null;
    this.currentBankStart = target.bankStart;
    return this.sendOsc("/setBankStart", [target.bankStart], { action: "setBankStart", bankStart: target.bankStart });
};

TotalMixOscService.prototype.selectChannelTarget = function(target) {
    if (!target) return null;
    this.selectBusSection(target.bus || "input");
    if (this.currentBankStart !== target.page2Index) {
        this.currentBankStart = target.page2Index;
        this.sendOsc("/setBankStart", [target.page2Index], { action: "selectPage2Channel", channel: "CH" + target.number });
    }
    this.selectedChannelNumber = target.number;
    return { sent: true, integration: "osc", action: "selectPage2Channel", channel: "CH" + target.number, bankStart: target.page2Index };
};

TotalMixOscService.prototype.sendChannelControl = function(channel, control, value, payload) {
    var pair = channelPairFromKey(channel);
    if (pair) {
        var messages = pair.map(function(pairChannel) {
            return this.sendChannelControl(pairChannel, control, value, Object.assign({}, payload || {}, {
                pairedChannel: channel,
                pairMember: pairChannel
            }));
        }, this);
        return {
            sent: messages.every(function(message) { return !!(message && message.sent); }),
            integration: "osc",
            profile: this.profile.id,
            action: payload && payload.action || "sendChannelControl",
            channel: channel,
            control: control,
            value: value,
            messages: messages
        };
    }
    var target = this.channelTarget(channel);
    if (!target) return this.pending("sendChannelControl", { channel: channel, control: control, value: value });
    if (control === "solo" && this.profile && this.profile.id === "rmeBabyfaceProFs12") {
        return this.setBabyfaceChannelPfl(channel, !!(payload && payload.enabled), payload);
    }
    var useSelectedChannelControl = target.bus === "playback" && (control === "volume" || control === "pan");
    var page1Address = null;
    if (!useSelectedChannelControl && control === "volume") page1Address = "/1/volume" + target.index;
    if (!useSelectedChannelControl && control === "pan") page1Address = "/1/pan" + target.index;
    if (control === "mute") page1Address = "/1/mute/1/" + target.index;
    if (control === "solo") page1Address = "/1/solo/1/" + target.index;
    if (control === "select") page1Address = "/1/select/1/" + target.index;
    if (page1Address) {
        this.ensureBank(target);
        if (control === "select") this.selectedChannelNumber = target.number;
        return this.sendOsc(page1Address, [value], Object.assign({
            channel: channel,
            oscControl: control,
            oscPage: 1,
            oscIndex: target.index
        }, payload || {}));
    }
    this.selectChannelTarget(target);
    return this.sendOsc("/2/" + control, [value], Object.assign({
        channel: channel,
        oscControl: control,
        oscPage: 2,
        oscIndex: target.index
    }, payload || {}));
};

TotalMixOscService.prototype.submixIndex = function(master) {
    var key = String(master || "").toLowerCase();
    var map = {
        mix: 0,
        stereo: 0,
        aux1: 4,
        aux2: 5,
        aux3: 6,
        aux4: 7,
        eff1: 0,
        effect1: 0,
        eff2: 0,
        effect2: 0
    };
    return map[key] === undefined ? 0 : map[key];
};

TotalMixOscService.prototype.outputMasterFromIndex = function(index) {
    var map = {
        0: "stereo",
        4: "aux1",
        5: "aux2",
        6: "aux3",
        7: "aux4"
    };
    return map[index] || null;
};

TotalMixOscService.prototype.selectSubmix = function(master) {
    var next = String(master || "mix").toLowerCase();
    if (this.inputBusRestoreTimer) {
        clearTimeout(this.inputBusRestoreTimer);
        this.inputBusRestoreTimer = null;
    }
    if (this.currentBusSection !== "input") this.selectBusSection("input");
    if (this.currentSubmixMode === next) return null;
    this.currentSubmixMode = next;
    return this.sendOsc("/setSubmix", [this.submixIndex(master)], { action: "setSubmix", mode: master });
};

TotalMixOscService.prototype.selectOutputChannel = function(master) {
    var index = this.submixIndex(master);
    if (this.inputBusRestoreTimer) {
        clearTimeout(this.inputBusRestoreTimer);
        this.inputBusRestoreTimer = null;
    }
    if (this.currentBusSection === "output" && this.currentBankStart === index) return index;
    this.selectBusSection("output");
    this.currentBankStart = index;
    this.sendOsc("/setBankStart", [index], { action: "selectOutputChannel", mode: master, outputIndex: index });
    return index;
};

TotalMixOscService.prototype.scheduleInputBusRestore = function(action, payload) {
    if (this.inputBusRestoreTimer) clearTimeout(this.inputBusRestoreTimer);
    var self = this;
    this.inputBusRestoreTimer = setTimeout(function() {
        self.inputBusRestoreTimer = null;
        self.sendOsc("/1/busInput", [1.0], Object.assign({ action: action || "restoreInputBus" }, payload || {}));
        self.currentBusSection = "input";
        self.currentBankStart = null;
    }, 350);
};

TotalMixOscService.prototype.initializeBabyfaceEqState = function() {
    for (var number = 1; number <= 12; number++) {
        this.selectChannelTarget(this.channelTarget("CH" + number));
        this.sendOsc("/2/lowcutEnable", [0.0], { action: "startupResetLowcut", channel: "CH" + number });
    }
    ["stereo", "aux1", "aux2", "aux3", "aux4"].forEach(function(master) {
        this.selectOutputChannel(master);
        this.sendOsc("/1/busInput", [1.0], { action: "restoreInputBusAfterStartupEq", master: master });
        this.currentBankStart = null;
    }, this);
    this.selectChannelTarget(this.channelTarget("CH1"));
};

TotalMixOscService.prototype.parameterValue = function(parameterId, value) {
    if (/^masterFader\.|^channelFader\.|^auxSend\.|^fx[12]Send\.|^effectReturnSend\./.test(parameterId)) return midiToUnit(value);
    if (/^pan\./.test(parameterId)) return clamp(value, 0, 32) / 32;
    if (/^width\./.test(parameterId)) return clamp(value, 0, 1);
    if (/^gain\./.test(parameterId)) {
        var gainChannel = channelNumberFromKey(String(parameterId).split(".")[1]);
        if (gainChannel === 3 || gainChannel === 4) return clamp(value, 0, 9) / 9;
        return gainToUnit(value);
    }
    if (/^pad\./.test(parameterId)) return toggleToInt(value) ? 1.0 : 0.0;
    if (/^inputLevel\./.test(parameterId)) return clamp(value, 0, 2) / 2;
    if (/^effect\./.test(parameterId)) {
        var effectParts = String(parameterId).split(".");
        var effectKind = effectParts[1] || "";
        var effectParam = effectParts[2] || "";
        if (effectParam === "volume") return effectVolumeValue(value);
        if (effectParam === "width") return effectLinearValue(value, 0, 1);
        if (effectParam === "roomScale") return effectLinearValue(value, 0.5, 3.0);
        if (effectParam === "preDelay") return effectLinearValue(value, 0, 999);
        if (effectParam === "lowCut") return effectHzValue(value, 20, 500);
        if (effectParam === "highCut") return effectHzValue(value, 2000, 20000);
        if (effectParam === "highDamp") return effectHzValue(value, 2000, 20000);
        if (effectParam === "hc") return echoHighCutValue(value);
        if (effectParam === "delayTime") {
            return echoDelayValue(value);
        }
        if (effectParam === "attack") return effectLinearValue(value, 5, 400);
        if (effectParam === "hold") return effectLinearValue(value, 5, 400);
        if (effectParam === "release") return effectLinearValue(value, 5, 500);
        if (effectParam === "feedback" || effectParam === "smooth") return effectLinearValue(value, 0, 100);
        if (effectParam === "type") return this.effectTypeValue(effectKind, value);
        return effectKind === "echo" ? effectLinearValue(value, 0, 100) : effectLinearValue(value, 0, 999);
    }
    if (/^phantom\.|^master\.subsonic\./.test(parameterId)) return toggleToInt(value);
    return value;
};

TotalMixOscService.prototype.effectTypeValue = function(kind, slug) {
    var normalized = String(slug || "").toLowerCase().replace(/\s+/g, "-");
    if (kind === "echo") {
        var echoMap = {
            "stereo-echo": 0,
            "stereo-cross": 0.5,
            "pong-echo": 1
        };
        return echoMap[normalized] !== undefined ? echoMap[normalized] : 0;
    }
    if (normalized === "envelope" || normalized === "gated" || normalized === "space") {
        return null;
    }
    var reverbMap = {
        "small-room": 0,
        "medium-room": 1 / 14,
        "large-room": 2 / 14,
        "thicker": 14 / 14
    };
    if (reverbMap[normalized] !== undefined) return reverbMap[normalized];
    var reverb = [
        "small-room",
        "medium-room",
        "large-room",
        "walls",
        "shorty",
        "attack",
        "swagger",
        "old-school",
        "echolistic",
        "8plus9",
        "grand-wide",
        "thicker",
        "envelope",
        "gated",
        "space"
    ];
    var list = reverb;
    var index = list.indexOf(normalized);
    if (index < 0) index = 0;
    return list.length <= 1 ? 0 : index / (list.length - 1);
};

TotalMixOscService.prototype.sendCommand = function(commandId) {
    var id = String(commandId || "");
    if (id === "totalmix.snapshot.1" || id === "totalmix.snapshot1" || id === "snapshot.1") {
        return this.recallStartupSnapshot();
    }
    var effectMatch = id.match(/^(?:totalmix\.)?effect\.(reverb|echo)\.preset\.(.+)$/);
    if (effectMatch) {
        return this.sendOsc("/3/" + effectMatch[1] + "Type", [this.effectTypeValue(effectMatch[1], effectMatch[2])], { action: "sendCommand", commandId: commandId });
    }
    var effectRowMatch = id.match(/^totalmix\.effect\.(effect1|effect2)\.(.+)$/);
    if (effectRowMatch) {
        return this.sendOsc("/3/" + effectRowMatch[1] + "Type", [effectRowMatch[2]], { action: "sendCommand", commandId: commandId });
    }
    if (id.indexOf("effect1.preset.") === 0 || id.indexOf("effect.preset.") === 0) {
        return this.sendOsc("/3/reverbType", [id.split(".").pop()], { action: "sendCommand", commandId: commandId });
    }
    var bankMatch = id.match(/^totalmix\.bankStart\.(\d+)$/);
    if (bankMatch) {
        this.currentBankStart = parseInt(bankMatch[1], 10) || 0;
        return this.sendOsc("/setBankStart", [this.currentBankStart], { action: "setBankStart", commandId: commandId });
    }
    return this.pending("sendCommand", { commandId: commandId });
};

TotalMixOscService.prototype.recallStartupSnapshot = function() {
    if (!this.startupSnapshotAddress) {
        return this.pending("sendCommand", { commandId: "totalmix.snapshot.1", reason: "startup-snapshot-disabled" });
    }
    return this.sendOsc(this.startupSnapshotAddress, [1.0], { action: "startupRecallSnapshot", snapshot: 1, address: this.startupSnapshotAddress });
};

TotalMixOscService.prototype.sendParameter = function(parameterId, value) {
    var id = String(parameterId || "");
    var parts = id.split(".");
    var registered = this.sendBabyfaceRegisteredParameter(id, value);
    if (registered) return registered;
    if (parts[0] === "channelFader") {
        if (this.profile && this.profile.id === "rmeBabyfaceProFs12") this.selectSubmix("mix");
        return this.sendChannelControl(parts[1], "volume", midiToUnit(value), { action: "sendParameter", parameterId: id, value: value });
    }
    if (parts[0] === "pan") {
        return this.sendChannelControl(parts[1], "pan", this.parameterValue(id, value), { action: "sendParameter", parameterId: id, value: value });
    }
    if (parts[0] === "width") {
        return this.sendChannelControl(parts[1], "width", this.parameterValue(id, value), { action: "sendParameter", parameterId: id, value: value });
    }
    if (parts[0] === "phantom") {
        if (channelNumberFromKey(parts[1]) > 2) return this.pending("sendParameter", { parameterId: id, value: value, reason: "phantom-not-available-on-adat-channel" });
        return this.sendChannelControl(parts[1], "phantom", 1.0, { action: "sendParameter", parameterId: id, value: value, oscRole: "toggle-pulse" });
    }
    if (parts[0] === "auxSend" && parts.length >= 3) {
        this.selectSubmix(parts[1].toLowerCase());
        return this.sendChannelControl(parts[2], "volume", midiToUnit(value), { action: "sendParameter", parameterId: id, value: value });
    }
    if (parts[0] === "fx1Send" || parts[0] === "fx2Send") {
        return this.sendChannelControl(parts[1], "reverbSend", midiToUnit(value), { action: "sendParameter", parameterId: id, value: value });
    }
    if (parts[0] === "effectReturnSend") return this.pending("sendParameter", { parameterId: id, value: value, reason: "unsupported-effect-return" });
    if (parts[0] === "masterFader") {
        if (parts[1] === "effect1") {
            return this.sendOsc("/3/reverbVolume", [midiToUnit(value)], { action: "sendParameter", parameterId: id, value: value, oscRole: "reverb-master-volume" });
        }
        if (parts[1] === "effect2") {
            return this.sendOsc("/3/echoVolume", [midiToUnit(value)], { action: "sendParameter", parameterId: id, value: value, oscRole: "echo-master-volume" });
        }
        if (parts[1] !== "stereo" && parts[1] !== "mix") {
            this.selectOutputChannel(parts[1]);
            var result = this.sendOsc("/2/volume", [midiToUnit(value)], { action: "sendParameter", parameterId: id, value: value, oscRole: "output-master-volume" });
            this.scheduleInputBusRestore("restoreInputBusAfterMasterFader", { parameterId: id });
            return result;
        }
        return this.sendOsc("/1/mastervolume", [midiToUnit(value)], { action: "sendParameter", parameterId: id, value: value });
    }
    if (parts[0] === "master" && parts[1] === "subsonic") {
        var masterId = parts[2] || "stereo";
        var enabled = value !== null && value !== undefined && !!parseInt(value, 10);

        if (!this.subsonicState) this.subsonicState = {};
        var wasEnabled = !!this.subsonicState[masterId];

        this.selectOutputChannel(masterId);

        var self = this;

        setTimeout(function() {
            if (wasEnabled !== enabled) {
                self.sendOsc("/2/lowcutEnable", [1.0], { action: "sendParameter", parameterId: id, value: value, oscRole: "subsonic-enable-toggle" });
            }

            if (enabled) {
                self.sendOsc("/2/lowcutGrade", [1.0], { action: "sendParameter", parameterId: id, value: value, oscRole: "subsonic-grade-24db" });
                self.sendOsc("/2/lowcutFreq", [value <= 25 ? 0.12 : 0.18], { action: "sendParameter", parameterId: id, value: value, oscRole: "subsonic-frequency" });
            }

            self.subsonicState[masterId] = enabled;
            //
            // Disabled for Babyface.
            // Restoring input bus causes subsequent HPF commands
            // to target CH1 instead of the selected output/master.
            //
            // self.sendOsc("/1/busInput", [1.0], { action: "restoreInputBusAfterSubsonic", parameterId: id });
            // self.currentBankStart = null;
        }, 60);

        return { sent: true, integration: "osc", profile: this.profile.id, action: "sendParameter", parameterId: id, value: value, oscRole: "subsonic-output-lowcut-delayed" };
    }
    if (parts[0] === "effect" && (parts[1] === "reverb" || parts[1] === "echo")) {
        var effectControlMap = {
            preDelay: "Predelay",
            lowCut: "Lowcut",
            highCut: "Highcut",
            roomScale: "Roomscale",
            reverbTime: "Time",
            highDamp: "Highdamp",
            attack: "Attack",
            hold: "Hold",
            release: "Release",
            smooth: "Smooth",
            width: "Width",
            volume: "Volume",
            type: "Type",
            delayTime: "Delaytime",
            feedback: "Feedback",
            hc: "HC"
        };
        var effectControl = effectControlMap[parts[2]] || parts.slice(2).map(function(part) {
            return part.charAt(0).toUpperCase() + part.slice(1);
        }).join("");
        var effectValue = this.parameterValue(id, value);
        if (parts[2] === "type" && effectValue === null) {
            return this.pending("sendParameter", { parameterId: id, value: value, reason: "unsupported-reverb-type-over-osc" });
        }
        return this.sendOsc("/3/" + parts[1] + effectControl, [effectValue], { action: "sendParameter", parameterId: id, value: value });
    }
    return this.pending("sendParameter", { parameterId: parameterId, value: value });
};

TotalMixOscService.prototype.sendParameterCc = TotalMixOscService.prototype.sendParameter;

TotalMixOscService.prototype.setChannelOn = function(channel, enabled) {
    return this.sendChannelControl(channel, "mute", enabled ? 0.0 : 1.0, { action: "setChannelOn", enabled: !!enabled, oscRole: "mute-inverted-from-on" });
};

TotalMixOscService.prototype.setChannelSolo = function(channel, enabled) {
    return this.sendChannelControl(channel, "solo", enabled ? 1.0 : 0.0, { action: "setChannelSolo", enabled: !!enabled, oscRole: "pfl-exclusive" });
};

TotalMixOscService.prototype.setBabyfaceChannelPfl = function(channel, enabled, payload) {
    var target = this.channelTarget(channel);
    if (!target) return this.pending("setBabyfaceChannelPfl", { channel: channel, enabled: !!enabled });
    var key = "CH" + target.number;
    if (!this.babyfacePflState) this.babyfacePflState = {};
    var hasKnownState = Object.prototype.hasOwnProperty.call(this.babyfacePflState, key);
    var wasEnabled = !!this.babyfacePflState[key];
    if (wasEnabled === !!enabled && (enabled || hasKnownState)) {
        return Object.assign({
            sent: true,
            integration: "osc",
            profile: this.profile.id,
            action: "setChannelSolo",
            channel: channel,
            enabled: !!enabled,
            oscRole: "pfl-state-unchanged"
        }, payload || {});
    }
    this.selectChannelTarget(target);
    if (enabled) {
        Object.keys(this.babyfacePflState).forEach(function(stateKey) {
            this.babyfacePflState[stateKey] = false;
        }, this);
    }
    this.babyfacePflState[key] = !!enabled;
    if (!enabled) {
        this.ensureBank(target);
        return this.sendOsc("/1/solo/1/" + target.index, [0.0], Object.assign({
            channel: channel,
            oscControl: "solo",
            oscPage: 1,
            oscIndex: target.index,
            enabled: false,
            oscRole: "pfl-page-solo-off"
        }, payload || {}));
    }
    return this.sendOsc("/2/solo", [1.0], Object.assign({
        channel: channel,
        oscControl: "solo",
        oscPage: 2,
        oscIndex: target.index,
        enabled: true,
        oscRole: "pfl-selected-track-toggle-on"
    }, payload || {}));
};

TotalMixOscService.prototype.setBabyfaceOutputCue = function(master, enabled, payload) {
    var output = String(master || "stereo").toLowerCase();
    if (output === "mix") output = "stereo";
    if (output !== "stereo" && output !== "aux1" && output !== "aux2" && output !== "aux3" && output !== "aux4") {
        return this.pending("setBabyfaceOutputCue", { master: master, enabled: !!enabled, reason: "unsupported-output-cue" });
    }
    if (!this.babyfaceOutputCueState) this.babyfaceOutputCueState = {};
    var wasEnabled = !!this.babyfaceOutputCueState[output];
    if (wasEnabled === !!enabled) {
        return Object.assign({
            sent: true,
            integration: "osc",
            profile: this.profile.id,
            action: "setMasterSolo",
            master: output,
            enabled: !!enabled,
            oscRole: "cue-output-state-unchanged"
        }, payload || {});
    }
    this.selectOutputChannel(output);
    this.babyfaceOutputCueState[output] = !!enabled;
    var self = this;
    setTimeout(function() {
        self.selectOutputChannel(output);
        self.sendOsc("/2/cue", [1.0], Object.assign({
            action: "setMasterSolo",
            master: output,
            enabled: !!enabled,
            oscRole: enabled ? "cue-output-toggle-on" : "cue-output-toggle-off"
        }, payload || {}));
    }, 80);
    return {
        sent: true,
        integration: "osc",
        profile: this.profile.id,
        action: (payload && payload.action) || "setMasterSolo",
        master: output,
        enabled: !!enabled,
        delayed: true,
        oscRole: enabled ? "cue-output-toggle-on" : "cue-output-toggle-off"
    };
};

TotalMixOscService.prototype.setChannelPhase = function(channel, enabled) {
    return this.sendChannelControl(channel, "phase", 1.0, { action: "setChannelPhase", enabled: !!enabled, oscRole: "toggle-pulse" });
};

TotalMixOscService.prototype.selectChannel = function(channel) {
    return this.sendChannelControl(channel, "select", 1.0, { action: "selectChannel" });
};

TotalMixOscService.prototype.selectMasterBus = function(mode) {
    return this.selectSubmix(String(mode || "MIX").toLowerCase());
};

TotalMixOscService.prototype.setMasterOn = function(master, enabled) {
    if (master === "effect1") {
        return this.sendBabyfaceEffectOn("reverb", enabled ? 127 : 0);
    }
    if (master === "effect2") {
        return this.sendBabyfaceEffectOn("echo", enabled ? 127 : 0);
    }
    if (this.profile && this.profile.id === "rmeBabyfaceProFs12") {
        var output = String(master || "stereo").toLowerCase();
        if (output === "mix") output = "stereo";
        if (output !== "stereo" && output !== "aux1" && output !== "aux2" && output !== "aux3" && output !== "aux4") {
            return this.pending("setMasterOn", { master: master, enabled: !!enabled, reason: "unsupported-output-mute" });
        }
        if (!this.babyfaceOutputMuteState) this.babyfaceOutputMuteState = {};
        var muted = !enabled;
        var hasKnownState = Object.prototype.hasOwnProperty.call(this.babyfaceOutputMuteState, output);
        var wasMuted = !!this.babyfaceOutputMuteState[output];
        if (hasKnownState && wasMuted === muted) {
            return {
                sent: true,
                integration: "osc",
                profile: this.profile.id,
                action: "setMasterOn",
                master: output,
                enabled: !!enabled,
                muted: muted,
                oscRole: "output-mute-state-unchanged"
            };
        }
        this.selectOutputChannel(output);
        this.babyfaceOutputMuteState[output] = muted;
        return this.sendOsc("/2/mute", [1.0], {
            action: "setMasterOn",
            master: output,
            enabled: !!enabled,
            muted: muted,
            oscRole: muted ? "output-mute-toggle-on" : "output-mute-toggle-off"
        });
    }
    this.selectSubmix(master);
    return this.sendOsc("/1/globalMute", [enabled ? 0.0 : 1.0], { action: "setMasterOn", master: master, enabled: !!enabled, oscRole: "mute-inverted-from-on" });
};

TotalMixOscService.prototype.setMasterOnCc = TotalMixOscService.prototype.setMasterOn;

TotalMixOscService.prototype.setMasterSolo = function(master, enabled) {
    if (this.profile && this.profile.id === "rmeBabyfaceProFs12") {
        return this.setBabyfaceOutputCue(master, !!enabled, { action: "setMasterSolo", master: master, enabled: !!enabled, oscRole: "cue-output-toggle" });
    }
    this.selectSubmix(master);
    return this.sendOsc("/1/globalSolo", [enabled ? 1.0 : 0.0], { action: "setMasterSolo", master: master, enabled: !!enabled, oscRole: "pfl" });
};

TotalMixOscService.prototype.setAuxPrePostStartup = function(auxId, mode) {
    return this.pending("setAuxPrePostStartup", { aux: auxId, mode: mode });
};

TotalMixOscService.prototype.eqUnitValue = function(parameter, value) {
    var key = String(parameter || "").toUpperCase();
    if (key === "FREQ") return clamp(value, 0, 120) / 120;
    if (key === "GAIN") return clamp(value, 0, 72) / 72;
    if (key === "Q") return clamp(value, 0, 40) / 40;
    if (key === "Q_OR_TYPE") return clamp(value, 0, 42) / 42;
    return clamp(value, 0, 127) / 127;
};

TotalMixOscService.prototype.writeBabyfaceEqParameter = function(channel, band, parameter, value) {
    var target = this.channelTarget(channel);
    var outputTarget = false;
    if (!target) {
        outputTarget = true;
        this.selectOutputChannel(channel);
    } else {
        this.selectChannelTarget(target);
    }
    var self = this;
    function done(result) {
        if (outputTarget) {
            self.scheduleInputBusRestore("restoreInputBusAfterEq", { channel: channel, band: band, parameter: parameter });
        }
        return result;
    }
    var bandKey = String(band || "").toUpperCase();
    var paramKey = String(parameter || "").toUpperCase();
    var address = null;
    var oscValue = this.eqUnitValue(paramKey, value);
    if (bandKey === "HPF") {
        if (paramKey === "Q_OR_TYPE") {
            var gradeIndex = Math.max(0, Math.min(4, parseInt(value, 10) || 0));

            if (!this.rawHpfState) this.rawHpfState = {};
            var key = String(channel);
            var wasEnabled = !!this.rawHpfState[key];
            var wantsEnabled = gradeIndex > 0;

            if (wasEnabled !== wantsEnabled) {
                this.sendOsc("/2/lowcutEnable", [1.0], {
                    action: "writeEqParameter",
                    channel: channel,
                    band: band,
                    parameter: "lowcutEnable",
                    value: gradeIndex
                });
            }

            this.rawHpfState[key] = wantsEnabled;

            if (gradeIndex > 0) {
                return done(this.sendOsc("/2/lowcutGrade", [(gradeIndex - 1) / 3], {
                    action: "writeEqParameter",
                    channel: channel,
                    band: band,
                    parameter: parameter,
                    value: value
                }));
            }

            return done({
                sent: true,
                integration: "osc",
                action: "writeEqParameter",
                channel: channel,
                band: band,
                parameter: parameter,
                value: value
            });
        }
        if (paramKey === "FREQ") {
            address = "/2/lowcutFreq";
            oscValue = clamp(value, 0, 120) / 120;
        }
        if (!address) return done(this.pending("writeEqParameter", { channel: channel, band: band, parameter: parameter, value: value }));
        return done(this.sendOsc(address, [oscValue], { action: "writeEqParameter", channel: channel, band: band, parameter: parameter, value: value }));
    }
    var bandNumber = { LOW: 1, MID: 2, HIGH: 3 }[bandKey];
    if (!bandNumber) return done(this.pending("writeEqParameter", { channel: channel, band: band, parameter: parameter, value: value }));
    if (paramKey === "GAIN") address = "/2/eqGain" + bandNumber;
    if (paramKey === "FREQ") address = "/2/eqFreq" + bandNumber;
    if (paramKey === "Q") address = "/2/eqQ" + bandNumber;
    if (paramKey === "Q_OR_TYPE" && bandNumber === 1) {
        address = "/2/eqType1";
        oscValue = parseInt(value, 10) >= 41 ? 1.0 : 0.0;
    }
    if (paramKey === "Q_OR_TYPE" && bandNumber === 3) address = "/2/eqType3";
    if (paramKey === "Q_OR_TYPE" && bandNumber === 3) oscValue = parseInt(value, 10) >= 41 ? 1.0 : 0.0;
    if (!address) return done(this.pending("writeEqParameter", { channel: channel, band: band, parameter: parameter, value: value }));
    return done(this.sendOsc(address, [oscValue], { action: "writeEqParameter", channel: channel, band: band, parameter: parameter, value: value }));
};

TotalMixOscService.prototype.writeEqParameter = function(channel, band, parameter, value) {
    if (this.profile && this.profile.id === "rmeBabyfaceProFs12") {
        return this.writeBabyfaceEqParameter(channel, band, parameter, value);
    }
    var target = this.channelTarget(channel);
    var page = target ? target.page : 1;
    var index = target ? target.index : 0;
    var control = "eq" + (index || "Master") + "_" + String(band || "").toLowerCase() + "_" + String(parameter || "").toLowerCase();
    return this.sendOsc(this.oscAddress(page, control), [value], { action: "writeEqParameter", channel: channel, band: band, parameter: parameter, value: value });
};

TotalMixOscService.prototype.writeDynamicsBundle = function(target, values) {
    return this.pending("writeDynamicsBundle", { target: target, values: values, supported: false });
};

TotalMixOscService.prototype.writeSimplifiedEqControl = function(channel, controlId, value, state) {
    var target = this.channelTarget(channel);
    var page = target ? target.page : 1;
    var index = target ? target.index : 0;
    return this.sendOsc(this.oscAddress(page, "eq" + (index || "Master") + "_" + controlId), [value], { action: "writeSimplifiedEqControl", channel: channel, controlId: controlId, value: value, state: state });
};

TotalMixOscService.prototype.sendControl = function(control, value) {
    return this.sendOsc("/1/" + control, [value], { action: "sendControl", control: control, value: value });
};

TotalMixOscService.prototype.sendLegacyUiControl = function(legacyId, value) {
    return this.pending("sendLegacyUiControl", { legacyId: legacyId, value: value });
};

TotalMixOscService.prototype.sendCh1HiMidGain = function(gainDb) {
    return this.pending("sendCh1HiMidGain", { gainDb: gainDb });
};

TotalMixOscService.prototype.sendIdentityRequest = function() {
    return this.pending("sendIdentityRequest");
};

TotalMixOscService.prototype.sendCh2HiMidGainFixed = function() {
    return this.pending("sendCh2HiMidGainFixed");
};

TotalMixOscService.prototype.sendCh1PrototypeEqBand = function(band, gainDb) {
    return this.pending("sendCh1PrototypeEqBand", { band: band, gainDb: gainDb });
};

TotalMixOscService.prototype.channelKeyFromPageIndex = function(index) {
    if (this.currentBusSection === "playback") return "CH" + (12 + (this.currentBankStart || 0) + index);
    return "CH" + (this.currentBankStart + index);
};

TotalMixOscService.prototype.selectedChannelKey = function() {
    return "CH" + (this.selectedChannelNumber || 1);
};

TotalMixOscService.prototype.emitOscMeter = function(channelIndex, side, value) {
    var channel = this.channelKeyFromPageIndex(channelIndex);
    if (!this.oscMeters[channel]) this.oscMeters[channel] = { left: -60, right: -60 };
    var db = -60 + clamp(value, 0, 1) * 60;
    this.oscMeters[channel][side] = db;
    if (this.oscMeterLeftIndex === this.oscMeterRightIndex && channelIndex === this.oscMeterLeftIndex) {
        this.oscMeterFrame.left = db;
        this.oscMeterFrame.right = db;
    } else {
        if (channelIndex === this.oscMeterLeftIndex && side === "left") this.oscMeterFrame.left = db;
        if (channelIndex === this.oscMeterRightIndex && side === "right") this.oscMeterFrame.right = db;
    }
    if ((channelIndex === this.oscMeterLeftIndex || channelIndex === this.oscMeterRightIndex) && this.onMeterFrame) {
        var left = this.oscMeterFrame.left;
        var right = this.oscMeterFrame.right;
        this.onMeterFrame({
            data: {
                left_rms: left,
                right_rms: right,
                left_ppm: left,
                right_ppm: right,
                left_peak: left,
                right_peak: right,
                left_peak_hold: left,
                right_peak_hold: right,
                momentary_lufs: Math.max(-70, (left + right) / 2 - 18),
                integrated_lufs: Math.max(-70, (left + right) / 2 - 18),
                spectrum: []
            },
            sampleRate: 44100,
            status: "RECEIVING TOTALMIX OSC METER",
            timestamp: Date.now()
        });
    }
};

TotalMixOscService.prototype.mapIncomingToLegacyUi = function() {
    return null;
};

TotalMixOscService.prototype.logMappedIncomingEvents = function(address, events) {
    (events || []).forEach(function(event) {
        if (!event || !event.group) return;
        if (event.group === "gain" ||
            event.group === "inputLevel" ||
            event.group === "effectState" ||
            event.group === "effectReturnSend") {
            console.log("OSC CONTROL READ", address, JSON.stringify(event));
        }
    });
};

TotalMixOscService.prototype.mapIncomingToUi = function(message) {
    if (!message || !message.address) return [];
    var address = message.address;
    var value = message.args && message.args.length ? message.args[0] : 0;
    var events = [];
    var match;

    match = address.match(/^\/1\/volume(\d+)$/);
    if (match) {
        var pageVolumeTarget = this.channelKeyFromPageIndex(parseInt(match[1], 10));
        var pageAuxMap = { aux1: "AUX1", aux2: "AUX2", aux3: "AUX3", aux4: "AUX4" };
        var pageFxMap = { eff1: "fx1Send", effect1: "fx1Send", eff2: "fx2Send", effect2: "fx2Send" };
        if (pageAuxMap[this.currentSubmixMode]) {
            events.push({ group: "auxSend", aux: pageAuxMap[this.currentSubmixMode], target: pageVolumeTarget, value: unitToMidi(value) });
        } else {
            events.push({ group: pageFxMap[this.currentSubmixMode] || "channelFader", target: pageVolumeTarget, value: unitToMidi(value) });
        }
        this.logMappedIncomingEvents(address, events);
        return events;
    }
    match = address.match(/^\/1\/pan(\d+)$/);
    if (match) {
        events.push({ group: "pan", target: this.channelKeyFromPageIndex(parseInt(match[1], 10)), value: unitToMidi(value), valueMax: 127 });
        this.logMappedIncomingEvents(address, events);
        return events;
    }
    match = address.match(/^\/1\/mute\/1\/(\d+)$/);
    if (match) {
        events.push({ group: "channelOn", target: this.channelKeyFromPageIndex(parseInt(match[1], 10)), enabled: !toggleToInt(value) });
        this.logMappedIncomingEvents(address, events);
        return events;
    }
    match = address.match(/^\/1\/solo\/1\/(\d+)$/);
    if (match) {
        events.push({ group: "channelSolo", target: this.channelKeyFromPageIndex(parseInt(match[1], 10)), enabled: !!toggleToInt(value) });
        this.logMappedIncomingEvents(address, events);
        return events;
    }
    match = address.match(/^\/1\/select\/1\/(\d+)$/);
    if (match && toggleToInt(value)) {
        this.selectedChannelNumber = this.currentBankStart + parseInt(match[1], 10);
        events.push({ group: "channelSelect", target: this.selectedChannelKey() });
        return events;
    }
    match = address.match(/^\/1\/level(\d+)(Left|Right)$/);
    if (match) {
        this.emitOscMeter(parseInt(match[1], 10), match[2] === "Left" ? "left" : "right", value);
        return events;
    }
    if (address === "/1/mastervolume") {
        events.push({ group: "masterFader", target: "stereo", value: unitToMidi(value) });
        return events;
    }
    if (address === "/1/labelSubmix" || address === "/2/labelSubmix") {
        var submixLabel = String(value || "").toLowerCase();
        if (submixLabel === "main" || submixLabel === "an 1/2" || submixLabel.indexOf("main") >= 0) this.currentSubmixMode = "mix";
        return events;
    }

    if (address === "/setBankStart") {
        this.currentBankStart = Math.round(parseFloat(value) || 0);
        this.selectedChannelNumber = this.currentBankStart + 1;
        return events;
    }
    if (address === "/3/reverbEnable") {
        if (!this.babyfaceEffectEnableState) this.babyfaceEffectEnableState = {};
        this.babyfaceEffectEnableState.reverb = !!toggleToInt(value);
        events.push({ group: "effectState", effect: "reverb", enabled: this.babyfaceEffectEnableState.reverb });
    }
    else if (address === "/3/echoEnable") {
        if (!this.babyfaceEffectEnableState) this.babyfaceEffectEnableState = {};
        this.babyfaceEffectEnableState.echo = !!toggleToInt(value);
        events.push({ group: "effectState", effect: "echo", enabled: this.babyfaceEffectEnableState.echo });
    }
    if (events.length) {
        this.logMappedIncomingEvents(address, events);
        return events;
    }
    if (address === "/2/volume") {
        var auxMap = { aux1: "AUX1", aux2: "AUX2", aux3: "AUX3", aux4: "AUX4" };
        var fxMap = { eff1: "fx1Send", effect1: "fx1Send", eff2: "fx2Send", effect2: "fx2Send" };
        if (auxMap[this.currentSubmixMode]) {
            events.push({ group: "auxSend", aux: auxMap[this.currentSubmixMode], target: this.selectedChannelKey(), value: unitToMidi(value) });
        } else {
            events.push({ group: fxMap[this.currentSubmixMode] || "channelFader", target: this.selectedChannelKey(), value: unitToMidi(value) });
        }
    }
    else if (address === "/2/pan") events.push({ group: "pan", target: this.selectedChannelKey(), value: unitToMidi(value), valueMax: 127 });
    else if (address === "/2/width") events.push({ group: "width", target: this.selectedChannelKey(), value: clamp(parseFloat(value) || 0, 0, 1) });
    else if (address === "/2/mute") {
        if (this.currentBusSection === "output") {
            var muted = !!toggleToInt(value);
            var outputMaster = this.outputMasterFromIndex(this.currentBankStart);
            if (outputMaster) {
                if (!this.babyfaceOutputMuteState) this.babyfaceOutputMuteState = {};
                this.babyfaceOutputMuteState[outputMaster] = muted;
                events.push({ group: "masterOn", target: outputMaster, masterId: outputMaster, enabled: !muted });
            }
        } else {
            events.push({ group: "channelOn", target: this.selectedChannelKey(), enabled: !toggleToInt(value) });
        }
    }
    else if (address === "/2/solo") events.push({ group: "channelSolo", target: this.selectedChannelKey(), enabled: !!toggleToInt(value) });
    else if (address === "/2/phase") events.push({ group: "phase", target: this.selectedChannelKey(), enabled: !!toggleToInt(value) });
    else if (address === "/2/phantom") events.push({ group: "phantom", target: this.selectedChannelKey(), enabled: !!toggleToInt(value) });
    else if (address === "/2/gain") events.push({ group: "gain", target: this.selectedChannelKey(), value: value });
    else if (address === "/2/gainRight") {
        var rightGainChannel = Math.min(12, this.selectedChannelNumber + 1);
        events.push({ group: "gain", target: "CH" + rightGainChannel, value: value });
    }
    else if ((match = address.match(/^\/1\/micgain(\d+)$/))) {
        var micGainChannel = parseInt(match[1], 10);
        events.push({ group: "gain", target: "CH" + micGainChannel, value: parseFloat(value) || 0 });
    }
    else if ((match = address.match(/^\/1\/refLevel([34])$/))) {
        events.push({ group: "inputLevel", target: "CH" + match[1], value: refLevelToInputLevelMode(value) });
    }
    else if (address === "/2/instrument") {
        if (toggleToInt(value)) events.push({ group: "inputLevel", target: this.selectedChannelKey(), value: 0 });
    }
    else if (address === "/2/lowcutEnable") events.push({ group: "hpf", target: this.selectedChannelKey(), enabled: !!toggleToInt(value) });
    else if (address === "/2/lowcutFreq") events.push({ group: "rawEq", target: this.selectedChannelKey(), band: "HPF", control: "freq", value: Math.round((parseFloat(value) || 0) * 120) });
    else if (address === "/2/lowcutGrade") events.push({ group: "rawEq", target: this.selectedChannelKey(), band: "HPF", control: "q", value: Math.round((parseFloat(value) || 0) * 3) + 1 });
    else if ((match = address.match(/^\/2\/eqGain([123])$/))) events.push({ group: "rawEq", target: this.selectedChannelKey(), band: ["LOW", "MID", "HIGH"][parseInt(match[1], 10) - 1], control: "gain", value: Math.round((parseFloat(value) || 0) * 72) });
    else if ((match = address.match(/^\/2\/eqFreq([123])$/))) events.push({ group: "rawEq", target: this.selectedChannelKey(), band: ["LOW", "MID", "HIGH"][parseInt(match[1], 10) - 1], control: "freq", value: Math.round((parseFloat(value) || 0) * 120) });
    else if ((match = address.match(/^\/2\/eqQ([123])$/))) events.push({ group: "rawEq", target: this.selectedChannelKey(), band: ["LOW", "MID", "HIGH"][parseInt(match[1], 10) - 1], control: "q", value: Math.round((parseFloat(value) || 0) * 40) });
    else if (address === "/2/eqType1") events.push({ group: "rawEq", target: this.selectedChannelKey(), band: "LOW", control: "type", value: (parseFloat(value) || 0) >= 0.5 ? 42 : 0 });
    else if (address === "/2/eqType3") events.push({ group: "rawEq", target: this.selectedChannelKey(), band: "HIGH", control: "type", value: (parseFloat(value) || 0) >= 0.5 ? 42 : 0 });
    else if (address === "/2/reverbSend") events.push({ group: "fx2Send", target: this.selectedChannelKey(), value: unitToMidi(value) });
    else if (address === "/2/reverbReturn") events.push({ group: "effectReturnSend", channelId: "RTN1", bus: this.currentSubmixMode === "mix" ? "master" : this.currentSubmixMode, value: unitToMidi(value) });
    else if (address === "/2/levelLeft") this.emitOscMeter(1, "left", value);
    else if (address === "/2/levelRight") this.emitOscMeter(1, "right", value);
    if (events.length) {
        this.logMappedIncomingEvents(address, events);
        return events;
    }

    if (address === "/3/reverbVolume") events.push({ group: "masterFader", target: "effect1", value: unitToMidi(value) });
    else if (address === "/3/echoVolume") events.push({ group: "masterFader", target: "effect2", value: unitToMidi(value) });
    this.logMappedIncomingEvents(address, events);
    return events;
};

function emptySceneStore() {
    return {
        version: 1,
        notes: "Editable Yamaha 01V scene names, channel labels, and safe mix setup snapshots.",
        sceneSaved: {},
        sceneDrafts: {},
        sceneNames: {},
        sceneNameDrafts: {},
        mixSetups: {},
        loadedScene: "01"
    };
}

function readSceneStore() {
    try {
        if (!fs.existsSync(sceneStorePath)) return emptySceneStore();
        return Object.assign(emptySceneStore(), JSON.parse(fs.readFileSync(sceneStorePath, "utf8")));
    } catch (error) {
        console.warn("Scene store read failed:", error.message);
        return emptySceneStore();
    }
}

function writeSceneStore(store) {
    fs.mkdirSync(path.dirname(sceneStorePath), { recursive: true });
    var next = Object.assign(emptySceneStore(), store || {});
    fs.writeFileSync(sceneStorePath, JSON.stringify(next, null, 2) + "\n", "utf8");
    return next;
}

function connectOutport(input, output, port, options) {
    options = options || {};
    var returncode = 0;
    var useOsc = options.integration === "osc" || (options.mixerProfile && options.mixerProfile.integration === "osc");
    var outPort = null;
    var inPort = null;
    if (!useOsc) {
        outPort = JZZ()
            .or("Cannot start MIDI engine!")
            .openMidiOut([output, 0]).or(function() { returncode = 1; });
        inPort = JZZ()
            .or("Cannot start MIDI engine!")
            .openMidiIn([input, 0]).or(function() { returncode = 1; });
    }
    var midi = useOsc ? new TotalMixOscService(options) : new MidiService(outPort, options);
    var engine = new LogicalEngine({ profile: useOsc ? "rmeBabyfaceProFs12" : "yamaha01v" });
    var meterAudioChannels = options.meterAudioChannels || { left: 0, right: 1, label: "1-2" };
    var meterAudioDeviceName = options.meterAudioDeviceName || "";
    var asioMeter = null;
    var optionalInputBankEnabled = !!options.optionalInputBankEnabled;
    var appMode = options.appMode === "tablet-only" ? "tablet-only" : "assist";

    if (useOsc) {
        midi.onIncoming = function(event) {
            io.emit("midi incoming", event);
        };
        asioMeter = new AsioMeterBridge(options.asioMeter || {}, function(frame) {
            latestAudioMeterFrame = frame;
            io.emit("audio meter frame", frame);
        });
        asioMeter.start();
        process.once("exit", function() {
            if (asioMeter) asioMeter.stop();
        });
        process.once("SIGINT", function() {
            if (asioMeter) asioMeter.stop();
            process.exit(0);
        });
        process.once("SIGTERM", function() {
            if (asioMeter) asioMeter.stop();
            process.exit(0);
        });
    }

    function midiStatus() {
        return {
            profile: midi.profile.id,
            profileName: midi.profile.name,
            channel: midi.channel,
            capabilities: midi.profile.capabilities || {},
            mixerProfile: options.mixerProfile || null
        };
    }

    function executeEngineCommands(commands) {
        return (commands || []).map(function(command) {
            if (command.type === "moduleIntent") {
                var result = Object.assign({}, command);
                result.messages = executeEngineCommands(command.commands || []);
                delete result.commands;
                return result;
            }
            if (command.type === "sendCommand") return midi.sendCommand(command.commandId);
            if (command.type === "sendParameter") return midi.sendParameter(command.parameterId, command.value);
            if (command.type === "writeEqParameter") return midi.writeEqParameter(command.channel, command.band, command.parameter, command.value);
            if (command.type === "writeDynamicsBundle") return midi.writeDynamicsBundle(command.target, command.values);
            return { sent: false, reason: "unknown-engine-command", command: command.type };
        });
    }

    console.log(useOsc ? "OSC profile:" : "MIDI profile:", midi.profile.name);
    console.log(useOsc ? "OSC channel:" : "MIDI channel:", midi.channel);
    if (useOsc) console.log("OSC target:", midi.oscHost + ":" + midi.oscPort);
    if (useOsc) console.log("OSC local receive port:", midi.oscLocalPort);
    if (useOsc && asioMeter) {
        console.log(
            "ASIO meter:",
            asioMeter.config.asioDriverName,
            "CH" + String(asioMeter.config.inputLeftChannel).padStart(2, "0") + "/CH" + String(asioMeter.config.inputRightChannel).padStart(2, "0"),
            asioMeter.config.sampleRate + "Hz",
            "channels=" + asioMeter.config.channelCount
        );
    }
    var auxPrePost = options.auxPrePost || {};
    var auxPreStartupNeeded = Object.keys(auxPrePost).some(function(auxId) {
        return String(auxPrePost[auxId] || "").toLowerCase() === "pre";
    });
    var sentStartupReset = false;
    if (!useOsc && (options.safeReset || auxPreStartupNeeded)) {
        try {
            console.log(auxPreStartupNeeded && !options.safeReset ?
                "Sending Yamaha 01V safe reset before AUX pre startup setup." :
                "Sending Yamaha 01V safe reset SysEx on startup.");
            midi.sendCommand("scene.safeReset");
            sentStartupReset = true;
        } catch (error) {
            console.warn("Startup safe reset failed:", error.message);
        }
    }

    function resetStartupAuxMasterFaders() {
        ["aux1", "aux2", "aux3", "aux4"].forEach(function(auxId) {
            try {
                console.log("Setting startup", auxId.toUpperCase(), "master fader to 0.");
                midi.sendParameter("masterFader." + auxId, 0);
            } catch (error) {
                console.warn("Startup AUX master fader reset failed for " + auxId.toUpperCase() + ":", error.message);
            }
        });
    }

    function applyStartupAuxPrePost() {
        Object.keys(auxPrePost).forEach(function(auxId) {
            var mode = String(auxPrePost[auxId] || "").toLowerCase();
            if (mode !== "pre") {
                console.log("Startup AUX", auxId, "left at Yamaha reset/default POST.");
                return;
            }
            try {
                console.log("Setting startup AUX", auxId, "sends to PRE for input channels 1-16.");
                midi.setAuxPrePostStartup(auxId, mode);
            } catch (error) {
                console.warn("Startup AUX pre/post setup failed for " + auxId + ":", error.message);
            }
        });
    }

    function applyStartupAfterReset() {
        resetStartupAuxMasterFaders();
        applyStartupAuxPrePost();
    }

    if (!useOsc && (auxPrePost || sentStartupReset)) {
        if (sentStartupReset) {
            setTimeout(applyStartupAfterReset, 1000);
        } else {
            applyStartupAuxPrePost();
        }
    }

    if (inPort) {
        inPort.connect(function(msg) {
            var bytes = Array.prototype.slice.call(msg || []);
            if (bytes[0] === 0xf0) {
                console.log("Incoming SysEx:", formatSysExBytes(bytes));
            }
            midi.mapIncomingToUi(msg).forEach(function(event) {
                if (event && (event.group === "channelSelect" || event.group === "channelSolo" || event.group === "masterSolo")) {
                    console.log("Mapped MIDI incoming:", JSON.stringify(event));
                }
                io.emit("midi incoming", event);
            });
            var mapped = midi.mapIncomingToLegacyUi(msg);
            if (mapped) {
                io.emit("fader change", mapped.legacyId, mapped.value);
            }
        });
    }

    io.on("connection", (socket) => {
        socket.emit("scene store", readSceneStore());
        socket.emit("engine modules", engine.describeModules());
        socket.emit("app mode", { mode: appMode });
        socket.emit("meter config", { audioChannels: meterAudioChannels, audioDeviceName: meterAudioDeviceName, optionalInputBankEnabled: optionalInputBankEnabled, asioMeter: options.asioMeter || null });
        if (latestAudioMeterFrame) socket.emit("audio meter frame", latestAudioMeterFrame);
        socket.on("scene store save", (store) => {
            try {
                writeSceneStore(store);
                socket.emit("scene store saved", { saved: true });
            } catch (error) {
                var warning = { sent: false, reason: "scene-store-save-error", message: error.message };
                console.warn("Scene store save failed", warning);
                socket.emit("midi warning", warning);
            }
        });
        socket.on("fader change", (note, value) => {
            var result = midi.sendLegacyUiControl(note, value);
            if (result.sent) {
                io.emit("fader change", note, value);
            } else {
                console.warn("Unsupported MIDI control", result);
                socket.emit("midi warning", result);
            }
        });
        socket.on("audio meter frame", (payload) => {
            if (!payload || !payload.data) return;
            latestAudioMeterFrame = {
                data: payload.data,
                sampleRate: payload.sampleRate,
                status: payload.status || "RUNNING",
                timestamp: Date.now()
            };
            socket.broadcast.emit("audio meter frame", latestAudioMeterFrame);
        });
        socket.on("audio meter request", (payload) => {
            if (asioMeter && (!payload || payload.active !== false)) asioMeter.start();
            socket.broadcast.emit("audio meter request", payload || { active: true });
        });
        socket.on("midi command", (command) => {
            if (!command || !command.control) return;
            var result = midi.sendControl(command.control, command.value);
            if (!result.sent) {
                console.warn("Unsupported MIDI command", result);
                socket.emit("midi warning", result);
            }
        });
        socket.on("midi action", (action) => {
            if (!action || !action.type) return;
            try {
                var result;
                if (action.type === "sendCommand") {
                    result = midi.sendCommand(action.commandId);
                } else if (action.type === "sendParameter") {
                    result = midi.sendParameter(action.parameterId, action.value);
                } else if (action.type === "sendParameterCc") {
                    result = midi.sendParameterCc(action.parameterId, action.value);
                } else if (action.type === "setChannelOn") {
                    result = midi.setChannelOn(action.channel, action.enabled);
                } else if (action.type === "setChannelSolo") {
                    result = midi.setChannelSolo(action.channel, action.enabled);
                } else if (action.type === "setChannelPhase") {
                    result = midi.setChannelPhase(action.channel, action.enabled);
                } else if (action.type === "setMasterOn") {
                    result = midi.setMasterOn(action.master, action.enabled);
                } else if (action.type === "setMasterOnCc") {
                    result = midi.setMasterOnCc(action.master, action.enabled);
                } else if (action.type === "setMasterSolo") {
                    result = midi.setMasterSolo(action.master, action.enabled);
                } else if (action.type === "selectChannel") {
                    result = midi.selectChannel(action.channel);
                } else if (action.type === "selectMasterBus") {
                    result = midi.selectMasterBus(action.mode);
                } else if (action.type === "writeEqParameter") {
                    result = midi.writeEqParameter(action.channel, action.band, action.parameter, action.value);
                } else if (action.type === "writeDynamicsBundle") {
                    result = midi.writeDynamicsBundle(action.target, action.values);
                } else if (action.type === "engineEqIntent") {
                    result = {
                        sent: true,
                        action: "engineEqIntent",
                        messages: executeEngineCommands(engine.setEqIntent(action.channel, action.control, action.value, action.state))
                    };
                } else if (action.type === "engineCompressorIntent") {
                    result = {
                        sent: true,
                        action: "engineCompressorIntent",
                        messages: executeEngineCommands(engine.setCompressorIntent(action.target, action.presetId, action.amount, action.state))
                    };
                } else if (action.type === "engineMasterCompressorIntent") {
                    result = {
                        sent: true,
                        action: "engineMasterCompressorIntent",
                        messages: executeEngineCommands(engine.setMasterCompressorIntent(action.target, action.state))
                    };
                } else if (action.type === "engineMasterEqIntent") {
                    result = {
                        sent: true,
                        action: "engineMasterEqIntent",
                        messages: executeEngineCommands(engine.setMasterEqIntent(action.target, action.control, action.value, action.state))
                    };
                } else if (action.type === "engineRawYamahaEqIntent") {
                    result = {
                        sent: true,
                        action: "engineRawYamahaEqIntent",
                        messages: executeEngineCommands(engine.setRawYamahaEqIntent(action.target, action.state))
                    };
                } else if (action.type === "engineAuxEqIntent") {
                    result = {
                        sent: true,
                        action: "engineAuxEqIntent",
                        messages: executeEngineCommands(engine.setAuxEqIntent(action.target, action.control, action.value, action.state))
                    };
                } else if (action.type === "engineEffectReturnEqIntent") {
                    result = {
                        sent: true,
                        action: "engineEffectReturnEqIntent",
                        messages: executeEngineCommands(engine.setEffectReturnEqIntent(action.target, action.control, action.value, action.state))
                    };
                } else if (action.type === "engineModulesDescribe") {
                    result = {
                        sent: true,
                        action: "engineModulesDescribe",
                        modules: engine.describeModules()
                    };
                } else if (action.type === "engineCommands") {
                    result = {
                        sent: true,
                        action: "engineCommands",
                        messages: executeEngineCommands(action.commands)
                    };
                } else if (action.type === "writeSimplifiedEqControl") {
                    result = midi.writeSimplifiedEqControl(action.channel, action.controlId, action.value, action.state);
                } else {
                    result = { sent: false, reason: "unknown-midi-action", action: action.type };
                }
                socket.emit("midi action status", result);
            } catch (error) {
                var warning = { sent: false, reason: "midi-action-error", message: error.message };
                console.warn("MIDI action failed", warning);
                socket.emit("midi warning", warning);
            }
        });
        socket.on("midi profile", (profileId) => {
            midi.setProfile(profileId);
            io.emit("midi status", midiStatus());
        });
        socket.on("midi channel", (channel) => {
            midi.setChannel(channel);
            io.emit("midi status", midiStatus());
        });
        socket.on("eq test ch1 himid gain", (gainDb) => {
            var result = midi.sendCh1HiMidGain(gainDb);
            if (!result.sent) {
                console.warn("EQ SysEx test not sent", result);
                socket.emit("midi warning", result);
            } else {
                socket.emit("eq test status", result);
            }
        });
        socket.on("sysex identity test", () => {
            var result = midi.sendIdentityRequest();
            socket.emit("eq test status", result);
        });
        socket.on("eq test ch2 himid gain fixed", () => {
            var result = midi.sendCh2HiMidGainFixed();
            socket.emit("eq test status", result);
        });
        socket.on("eq prototype ch1 band", (payload) => {
            if (!payload) return;
            var result = midi.sendCh1PrototypeEqBand(payload.band, payload.gainDb);
            if (!result.sent) {
                socket.emit("midi warning", result);
            } else {
                socket.emit("eq prototype status", result);
            }
        });
        socket.emit("midi status", midiStatus());
    });

    http.once("error", function(error) {
        if (error && error.code === "EADDRINUSE") {
            console.error("Festimix HTTP port is already in use:", port, "- close the previous server before starting another one.");
            return;
        }
        console.error("Festimix HTTP server error:", error && error.message ? error.message : error);
    });
    http.listen(port);
    return returncode;
}
module.exports = { connectOutport };
