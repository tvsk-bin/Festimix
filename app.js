var express = require("express");
var app = express();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var JZZ = require("jzz");
var fs = require("fs");
var path = require("path");
var MidiService = require("./lib/midi/service").MidiService;
var LogicalEngine = require("./lib/engine/logicalEngine").LogicalEngine;
var formatSysExBytes = require("./lib/midi/yamaha01vSysex").formatBytes;

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});
var outPort;
app.use("/assets", express.static(__dirname + '/assets'));

var sceneStorePath = path.join(__dirname, "data", "mix-setups.json");
var latestAudioMeterFrame = null;

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
    var outPort = JZZ()
        .or("Cannot start MIDI engine!")
        .openMidiOut([output, 0]).or(function() { returncode = 1; });
    var inPort = JZZ()
        .or("Cannot start MIDI engine!")
        .openMidiIn([input, 0]).or(function() { returncode = 1; });
    var midi = new MidiService(outPort, options);
    var engine = new LogicalEngine({ profile: "yamaha01v" });
    var meterAudioChannels = options.meterAudioChannels || { left: 0, right: 1, label: "1-2" };
    var meterAudioDeviceName = options.meterAudioDeviceName || "";
    var optionalInputBankEnabled = !!options.optionalInputBankEnabled;
    var appMode = options.appMode === "tablet-only" ? "tablet-only" : "assist";

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

    console.log("MIDI profile:", midi.profile.name);
    console.log("MIDI channel:", midi.channel);
    var auxPrePost = options.auxPrePost || {};
    var auxPreStartupNeeded = Object.keys(auxPrePost).some(function(auxId) {
        return String(auxPrePost[auxId] || "").toLowerCase() === "pre";
    });
    var sentStartupReset = false;
    if (options.safeReset || auxPreStartupNeeded) {
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

    if (auxPrePost || sentStartupReset) {
        if (sentStartupReset) {
            setTimeout(applyStartupAfterReset, 1000);
        } else {
            applyStartupAuxPrePost();
        }
    }

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

    io.on("connection", (socket) => {
        socket.emit("scene store", readSceneStore());
        socket.emit("engine modules", engine.describeModules());
        socket.emit("app mode", { mode: appMode });
        socket.emit("meter config", { audioChannels: meterAudioChannels, audioDeviceName: meterAudioDeviceName, optionalInputBankEnabled: optionalInputBankEnabled });
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
            var profile = midi.setProfile(profileId);
            io.emit("midi status", { profile: profile.id, profileName: profile.name, channel: midi.channel });
        });
        socket.on("midi channel", (channel) => {
            var nextChannel = midi.setChannel(channel);
            io.emit("midi status", { profile: midi.profile.id, profileName: midi.profile.name, channel: nextChannel });
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
        socket.emit("midi status", { profile: midi.profile.id, profileName: midi.profile.name, channel: midi.channel });
    });

    http.listen(port);
    return returncode;
}
module.exports = { connectOutport };
