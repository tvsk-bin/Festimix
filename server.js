"use strict";

var JZZ = require("jzz");
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var readline = require("readline");
var midiApp = require("./app");
var normalizeAsioMeterConfig = require("./lib/audio/asioMeterBridge").normalizeAsioMeterConfig;
var mixerRegistry = require("./lib/mixers");

var DEFAULT_MIDI_PORT = "Babyface Midi Port 1";
var SERVER_VERSION = "3.0.0";
var lastRunSettingsPath = path.join(__dirname, "data", "last-run-settings.json");
var MIXER_PROFILES = mixerRegistry.allMixerProfiles();
var BABYFACE_SOFTWARE_INPUT_PAIRS = [
    { left: 0, right: 1, label: "1-2", name: "Software Input 1-2" },
    { left: 2, right: 3, label: "3-4", name: "Software Input 3-4" },
    { left: 4, right: 5, label: "5-6", name: "Software Input 5-6" },
    { left: 6, right: 7, label: "7-8", name: "Software Input 7-8" },
    { left: 8, right: 9, label: "9-10", name: "Software Input 9-10" },
    { left: 10, right: 11, label: "11-12", name: "Software Input 11-12" },
    { left: 12, right: 13, label: "13-14", name: "Software Input 13-14" },
    { left: 14, right: 15, label: "15-16", name: "Software Input 15-16" }
];

function defaultAuxPrePostModes() {
    return { AUX1: "pre", AUX2: "pre", AUX3: "pre", AUX4: "pre" };
}

function moduleVersion(name) {
    try {
        var packagePath = require.resolve(name + "/package.json");
        return JSON.parse(fs.readFileSync(packagePath, "utf8")).version || "unknown";
    } catch (error) {
        return "unknown";
    }
}

function logServiceVersions() {
    console.log("");
    console.log("(c) TVSK 2026");
    console.log("Festimix v3");
    console.log("");
    console.log("Festimix service versions:");
    console.log("  main:", "v3");
    console.log("  server:", SERVER_VERSION);
    console.log("  node:", process.version);
    console.log("  socket.io:", moduleVersion("socket.io"));
    console.log("  express:", moduleVersion("express"));
    console.log("  jzz:", moduleVersion("jzz"));
    console.log("  midi mapping:", path.basename(require.resolve("./yamaha01v.mapping_v3.json")));
}

function listPorts() {
    var info = JZZ().info();
    console.log("\nAvailable MIDI inputs:");
    info.inputs.forEach(function(port, index) {
        console.log("  [" + index + "] " + port.name);
    });
    console.log("\nAvailable MIDI outputs:");
    info.outputs.forEach(function(port, index) {
        console.log("  [" + index + "] " + port.name);
    });
    return info;
}

function listAudioInputs() {
    if (process.platform !== "win32") return [];
    try {
        var script = [
            "$ErrorActionPreference='SilentlyContinue'",
            "$items=Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'AudioEndpoint' -and $_.Status -eq 'OK' -and $_.Name -match '(Microphone|Line|Input|Mic|Analog|USB|RME|Audio)' } | Sort-Object Name",
            "$items | ForEach-Object { $_.Name }"
        ].join("; ");
        var output = childProcess.execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        var seen = {};
        return output.split(/\r?\n/).map(function(line) { return line.trim(); }).filter(Boolean).filter(function(name) {
            if (/lautsprecher|speaker|headphone|output|kopfh/i.test(name)) return false;
            var key = name.toLowerCase();
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
    } catch (error) {
        return [];
    }
}

function listMeterAudioInputs() {
    console.log("\nMeter audio bemenetek (aktiv Windows capture endpointok):");
    var inputs = listAudioInputs();
    if (!inputs.length) {
        console.log("  Nem talaltam listazhato aktiv audio bemenetet.");
        console.log("  Ha a meter nem indul, ellenorizd a Windows Sound/Input beallitasokat.");
        return inputs;
    }
    inputs.forEach(function(name, index) {
        console.log("  [" + index + "] " + name);
    });
    return inputs;
}

function findPortByName(ports, requested, exactOnly) {
    var requestedName = String(requested).toLowerCase();
    var exact = ports.find(function(port) {
        return port.name.toLowerCase() === requestedName;
    });
    if (exact || exactOnly) return exact;

    return ports.find(function(port) {
        return port.name.toLowerCase().indexOf(requestedName) !== -1;
    });
}

function findPortByIndex(ports, requested) {
    if (requested === undefined || requested === null || requested === "") return null;
    var index = parseInt(requested, 10);
    if (isNaN(index)) return null;
    return ports[index] || null;
}

function resolvePortRequest(ports, requested, options) {
    if (!requested) return null;

    var byNumeric = findPortByIndex(ports, requested);
    if (byNumeric) {
        return { port: byNumeric.name, reason: options.label + " index: " + requested };
    }

    var byExactName = findPortByName(ports, requested, true);
    if (byExactName) {
        return { port: byExactName.name, reason: options.label + " exact match: " + requested };
    }

    var byPartialName = findPortByName(ports, requested, false);
    if (byPartialName) {
        return { port: byPartialName.name, reason: options.label + " partial match: " + requested };
    }

    return null;
}

function findDefaultPort(ports, options) {
    var byDefaultExact = findPortByName(ports, options.defaultName, true);
    if (byDefaultExact) {
        return { port: byDefaultExact.name, reason: "default exact match: " + options.defaultName };
    }

    var byDefaultPartial = findPortByName(ports, options.defaultName, false);
    if (byDefaultPartial) {
        return { port: byDefaultPartial.name, reason: "default partial match: " + options.defaultName };
    }

    return null;
}

function pickConfiguredPort(ports, options) {
    var requestedIndex = process.env[options.indexEnvName];
    var requested = process.env[options.envName];
    var byExplicitIndex = findPortByIndex(ports, requestedIndex);
    if (byExplicitIndex) {
        return { port: byExplicitIndex.name, reason: options.indexEnvName + "=" + requestedIndex };
    }
    if (requestedIndex) {
        console.warn("Requested " + options.indexEnvName + " not found:", requestedIndex);
    }

    if (requested) {
        var byRequest = resolvePortRequest(ports, requested, { label: options.envName });
        if (byRequest) {
            return byRequest;
        }
        console.warn("Requested " + options.envName + " not found:", requested);
    }

    return null;
}

function pickAutomaticPort(ports, options) {
    var byDefault = findDefaultPort(ports, options);
    if (byDefault) return byDefault;

    var emu = ports.find(function(port) {
        return port.name.toLowerCase().indexOf("e-mu") !== -1 || port.name.toLowerCase().indexOf("emu") !== -1;
    });
    if (emu) return { port: emu.name, reason: "legacy E-MU auto-selection" };

    if (ports[0]) return { port: ports[0].name, reason: "first detected port fallback" };
    throw new Error("No MIDI " + options.label + " ports found.");
}

function question(rl, prompt) {
    return new Promise(function(resolve) {
        rl.question(prompt, resolve);
    });
}

function readLastRunSettings() {
    try {
        if (!fs.existsSync(lastRunSettingsPath)) return null;
        return JSON.parse(fs.readFileSync(lastRunSettingsPath, "utf8"));
    } catch (error) {
        console.warn("Last run settings read failed:", error.message);
        return null;
    }
}

function writeLastRunSettings(settings) {
    try {
        fs.mkdirSync(path.dirname(lastRunSettingsPath), { recursive: true });
        fs.writeFileSync(lastRunSettingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    } catch (error) {
        console.warn("Last run settings save failed:", error.message);
    }
}

function defaultBabyfaceWorkspace() {
    var channels = {};
    for (var channel = 1; channel <= 12; channel++) {
        channels[String(channel)] = {
            label: "CH" + channel,
            input: channel,
            phantom: false,
            phase: false
        };
    }
    return {
        version: 1,
        mixerProfileId: "rmeBabyfaceProFs12",
        label: "Babyface Pro FS 12ch",
        channels: channels,
        buses: {
            mix: { label: "MIX" },
            aux1: { label: "AUX1" },
            aux2: { label: "AUX2" },
            aux3: { label: "AUX3" },
            aux4: { label: "AUX4" },
            effect1: { label: "FX" }
        },
        effects: {
            reverb: { preset: "default" },
            echo: { preset: "default" }
        }
    };
}

function loadOrCreateWorkspaceFile(mixerProfile) {
    if (!mixerProfile || !mixerProfile.workspaceFile) return null;
    try {
        if (fs.existsSync(mixerProfile.workspaceFile)) {
            return JSON.parse(fs.readFileSync(mixerProfile.workspaceFile, "utf8"));
        }
        var workspace = defaultBabyfaceWorkspace();
        fs.mkdirSync(path.dirname(mixerProfile.workspaceFile), { recursive: true });
        fs.writeFileSync(mixerProfile.workspaceFile, JSON.stringify(workspace, null, 2) + "\n", "utf8");
        console.log("Created workspace file:", mixerProfile.workspaceFile);
        return workspace;
    } catch (error) {
        console.warn("Workspace file load/create failed:", error.message);
        return null;
    }
}

function summarizeLastRunSettings(settings) {
    if (!settings) return;
    console.log("\nLast run settings:");
    console.log("  app mode:", settings.appMode || "assist");
    console.log("  mixer:", (settings.mixerProfile && settings.mixerProfile.label) || settings.mixerProfileId || "unknown");
    console.log("  midi input:", settings.midiInput || "default");
    console.log("  midi output:", settings.midiOutput || "default");
    console.log("  meter audio:", settings.meterAudioDeviceName || "default", "channels", (settings.meterAudioChannels && settings.meterAudioChannels.label) || "1-2");
    if (settings.asioMeter) {
        console.log("  ASIO meter:", settings.asioMeter.asioDriverName || "default", "CH" + String(settings.asioMeter.inputLeftChannel).padStart(2, "0") + "/CH" + String(settings.asioMeter.inputRightChannel).padStart(2, "0"));
    }
    console.log("  optional input bank:", settings.optionalInputBankEnabled ? "YES" : "NO");
    console.log("  aux pre/post:", JSON.stringify(settings.auxPrePost || defaultAuxPrePostModes()));
    console.log("  safe reset:", settings.safeReset ? "YES" : "NO");
}

function logStartupSettings(settings, heading) {
    console.log("\n" + heading + ":");
    console.log("  mixer:", settings.mixerProfile.label);
    console.log("  integration:", settings.mixerProfile.integration);
    if (settings.mixerProfile.integration === "midi") {
        console.log("  app mode:", settings.appMode);
        console.log("  MIDI input:", settings.input);
        if (settings.inputReason) console.log("    reason:", settings.inputReason);
        console.log("  MIDI output:", settings.output);
        if (settings.outputReason) console.log("    reason:", settings.outputReason);
        console.log("  MIDI profile:", settings.profile);
        console.log("  MIDI channel:", settings.channel);
        console.log("  meter audio device:", settings.meterAudioDeviceName || "default");
        console.log("  meter audio channels:", settings.meterAudioChannels.label);
        console.log("  optional input bank:", settings.optionalInputBankEnabled ? "YES" : "NO");
    } else {
        console.log("  OSC profile:", settings.profile);
        if (settings.workspaceFile) console.log("  workspace:", settings.workspaceFile);
        console.log("  spectrum loopback input:", settings.meterAudioChannels.name || settings.meterAudioChannels.label);
        if (settings.asioMeter) {
            console.log("  ASIO meter:", settings.asioMeter.asioDriverName, "CH" + String(settings.asioMeter.inputLeftChannel).padStart(2, "0") + "/CH" + String(settings.asioMeter.inputRightChannel).padStart(2, "0"), settings.asioMeter.sampleRate + "Hz", "channels=" + settings.asioMeter.channelCount);
        }
    }
    if (settings.mixerProfile.id === "yamaha01vDefault") {
        console.log("  AUX pre/post startup:", JSON.stringify(settings.auxPrePost));
    }
    if (settings.mixerProfile.integration === "midi") console.log("  startup safe reset:", settings.safeReset ? "YES" : "NO");
}

function parseAppModeAnswer(answer, defaultValue) {
    var fallback = defaultValue || "assist";
    var text = String(answer || "").trim().toLowerCase();
    if (!text) return fallback;
    if (text === "a" || text === "assist" || text === "assistant" || text === "assziszt" || text === "asist") return "assist";
    if (text === "m" || text === "master" || text === "t" || text === "tablet" || text === "tablet-only" || text === "tablet only" || text === "tabletonly") return "tablet-only";
    return fallback;
}

async function askAppMode(rl, defaultValue) {
    var envMode = process.env.FESTIMIX_APP_MODE || process.env.O1V_APP_MODE || "";
    if (envMode) return parseAppModeAnswer(envMode, defaultValue || "assist");
    return defaultValue || "assist";
}

function mixerStartupAppMode(mixerProfile) {
    return mixerProfile && mixerProfile.startup && mixerProfile.startup.appMode || "assist";
}

async function askLoadLastRunSettings(rl) {
    if (process.env.FESTIMIX_MIXER_PROFILE || process.env.MIXER_PROFILE) return null;
    if (!process.stdin.isTTY) return null;
    var settings = readLastRunSettings();
    if (!settings) return null;
    summarizeLastRunSettings(settings);
    var answer = await question(rl, "Load last run settings? [Y/n]: ");
    var text = answer.trim().toLowerCase();
    if (!text || text === "y" || text === "yes" || text === "i" || text === "igen") return settings;
    return null;
}

function parseMeterAudioChannels(answer) {
    var text = String(answer || "").trim();
    if (!text) return { left: 0, right: 1, label: "1-2" };
    var matches = text.match(/\d+/g);
    if (!matches || !matches.length) return { left: 0, right: 1, label: "1-2" };
    var left = Math.max(1, parseInt(matches[0], 10));
    var right = Math.max(1, parseInt(matches[1] || matches[0], 10));
    return {
        left: left - 1,
        right: right - 1,
        label: left === right ? String(left) : left + "-" + right
    };
}

function envValue(names) {
    for (var i = 0; i < names.length; i++) {
        if (process.env[names[i]] !== undefined && process.env[names[i]] !== "") return process.env[names[i]];
    }
    return "";
}

function savedOrEnvAsioValue(names, saved, key, fallback) {
    var env = envValue(names);
    if (env !== "") return env;
    if (saved && saved[key] !== undefined && saved[key] !== null && saved[key] !== "") return saved[key];
    return fallback;
}

function parseAsioMeterConfig(meterAudioChannels, saved) {
    var defaultLeft = meterAudioChannels ? ((parseInt(meterAudioChannels.left, 10) || 0) + 1) : 3;
    var defaultRight = meterAudioChannels ? ((parseInt(meterAudioChannels.right, 10) || defaultLeft - 1) + 1) : 4;
    return normalizeAsioMeterConfig({
        asioDriverName: savedOrEnvAsioValue(["FESTIMIX_ASIO_DRIVER_NAME", "ASIO_DRIVER_NAME"], saved, "asioDriverName", "ASIO Fireface USB"),
        inputLeftChannel: savedOrEnvAsioValue(["FESTIMIX_ASIO_INPUT_LEFT_CHANNEL", "ASIO_INPUT_LEFT_CHANNEL"], saved, "inputLeftChannel", defaultLeft),
        inputRightChannel: savedOrEnvAsioValue(["FESTIMIX_ASIO_INPUT_RIGHT_CHANNEL", "ASIO_INPUT_RIGHT_CHANNEL"], saved, "inputRightChannel", defaultRight),
        sampleRate: savedOrEnvAsioValue(["FESTIMIX_ASIO_SAMPLE_RATE", "ASIO_SAMPLE_RATE"], saved, "sampleRate", 44100),
        channelCount: savedOrEnvAsioValue(["FESTIMIX_ASIO_CHANNEL_COUNT", "ASIO_CHANNEL_COUNT"], saved, "channelCount", 12)
    });
}

function babyfaceSoftwareInputIndexForChannels(channels) {
    var left = channels && parseInt(channels.left, 10);
    var right = channels && parseInt(channels.right, 10);
    var index = BABYFACE_SOFTWARE_INPUT_PAIRS.findIndex(function(pair) {
        return pair.left === left && pair.right === right;
    });
    return index >= 0 ? index : 0;
}

function parseBabyfaceSoftwareInputAnswer(answer, defaultChannels) {
    var text = String(answer || "").trim();
    if (!text) return BABYFACE_SOFTWARE_INPUT_PAIRS[babyfaceSoftwareInputIndexForChannels(defaultChannels)];
    if (/\d+\s*-\s*\d+/.test(text)) {
        var parsed = parseMeterAudioChannels(text);
        var matchingIndex = babyfaceSoftwareInputIndexForChannels(parsed);
        if (BABYFACE_SOFTWARE_INPUT_PAIRS[matchingIndex].label === parsed.label) return BABYFACE_SOFTWARE_INPUT_PAIRS[matchingIndex];
    }
    var index = /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
    if (!isNaN(index)) {
        if (index >= 1 && index <= BABYFACE_SOFTWARE_INPUT_PAIRS.length) return BABYFACE_SOFTWARE_INPUT_PAIRS[index - 1];
        if (index >= 0 && index < BABYFACE_SOFTWARE_INPUT_PAIRS.length) return BABYFACE_SOFTWARE_INPUT_PAIRS[index];
    }
    var parsed = parseMeterAudioChannels(text);
    var matchingIndex = babyfaceSoftwareInputIndexForChannels(parsed);
    if (BABYFACE_SOFTWARE_INPUT_PAIRS[matchingIndex].label === parsed.label) return BABYFACE_SOFTWARE_INPUT_PAIRS[matchingIndex];
    return BABYFACE_SOFTWARE_INPUT_PAIRS[babyfaceSoftwareInputIndexForChannels(defaultChannels)];
}

async function askBabyfaceSpectrumInputPair(rl, defaultChannels) {
    var envChannels = process.env.FESTIMIX_BABYFACE_SPECTRUM_INPUT || process.env.O1V_METER_AUDIO_CHANNELS || "";
    if (envChannels) return parseBabyfaceSoftwareInputAnswer(envChannels, defaultChannels);
    if (!process.stdin.isTTY) return defaultChannels || BABYFACE_SOFTWARE_INPUT_PAIRS[0];
    var defaultIndex = babyfaceSoftwareInputIndexForChannels(defaultChannels);
    console.log("\nBabyface OSC spectrum/meter loopback forras:");
    console.log("  TotalMixben kapcsold be a Loopbackot azon a Phones/Main kimeneten, amit spektrumanalizalni akarsz.");
    console.log("  Itt csak a 8 lehetseges szoftver input part valasztjuk ki, fizikai inputokat nem listazunk.");
    BABYFACE_SOFTWARE_INPUT_PAIRS.forEach(function(pair, index) {
        console.log("  [" + (index + 1) + "] " + pair.name);
    });
    var answer = await question(rl, "Melyik software input par legyen a spektrum forrasa? [" + (defaultIndex + 1) + ": " + BABYFACE_SOFTWARE_INPUT_PAIRS[defaultIndex].label + "]: ");
    return parseBabyfaceSoftwareInputAnswer(answer, BABYFACE_SOFTWARE_INPUT_PAIRS[defaultIndex]);
}

function pickAudioInputName(inputs, answer) {
    var text = String(answer || "").trim();
    if (!text) return process.env.O1V_METER_AUDIO_DEVICE || "";
    var index = parseInt(text, 10);
    if (!isNaN(index) && inputs[index]) return inputs[index];
    var lower = text.toLowerCase();
    return inputs.find(function(name) { return name.toLowerCase().indexOf(lower) !== -1; }) || text;
}

function parsePrePostAnswer(answer) {
    var text = String(answer || "").trim().toLowerCase();
    if (!text) return "pre";
    if (text === "p" || text === "pre") return "pre";
    if (text === "post" || text === "po") return "post";
    return "pre";
}

function parseYesNoAnswer(answer, defaultValue) {
    var text = String(answer || "").trim().toLowerCase();
    if (!text) return !!defaultValue;
    if (text === "y" || text === "yes" || text === "i" || text === "igen") return true;
    if (text === "n" || text === "no" || text === "nem") return false;
    return !!defaultValue;
}

function wantsStartupRestart(answer) {
    var text = String(answer || "").trim().toLowerCase();
    return text === "n" || text === "no" || text === "nem" ||
        text === "u" || text === "ujra" || text === "újra" ||
        text === "v" || text === "vissza" || text === "back" || text === "b";
}

async function confirmStartupSettings(rl, settings) {
    if (process.env.FESTIMIX_MIXER_PROFILE || process.env.MIXER_PROFILE) return true;
    if (!process.stdin.isTTY) return true;
    logStartupSettings(settings, "Inditasi osszegzes");
    var answer = await question(rl, "Mehet az inditas? [ENTER=mehet / ujra=vissza az elejere]: ");
    return !wantsStartupRestart(answer);
}

async function askAuxPrePostModes(rl, mixerProfile) {
    var result = defaultAuxPrePostModes();
    if (!process.stdin.isTTY || !mixerProfile || mixerProfile.id !== "yamaha01vDefault") {
        return result;
    }
    console.log("\nYamaha 01V AUX send pre/post startup beallitas:");
    console.log("  Gyari alap: POST. Monitor hasznalathoz ajanlott: PRE.");
    console.log("  PRE valasztasnal az adott AUX osszes input csatornajat 1-16 atkapcsolom.");
    for (var aux = 1; aux <= 4; aux++) {
        var answer = await question(rl, "AUX" + aux + " legyen pre vagy post? [pre]: ");
        result["AUX" + aux] = parsePrePostAnswer(answer);
    }
    return result;
}

async function pickMixerProfile(rl, defaultProfile) {
    var fallback = mixerRegistry.configuredMixerProfile(defaultProfile || MIXER_PROFILES[0]);
    console.log("\nMixer tipus:");
    MIXER_PROFILES.forEach(function(profile, index) {
        console.log("  [" + index + "] " + profile.label + " (" + profile.integration + ")");
    });
    if (!process.stdin.isTTY || process.env.FESTIMIX_MIXER_PROFILE || process.env.MIXER_PROFILE) return fallback;
    var fallbackIndex = Math.max(0, MIXER_PROFILES.findIndex(function(profile) { return profile.id === fallback.id; }));
    var answer = await question(rl, "Valassz mixer tipust [" + fallbackIndex + ": " + fallback.label + "]: ");
    var index = parseInt(answer.trim(), 10);
    if (!isNaN(index) && MIXER_PROFILES[index]) return MIXER_PROFILES[index];
    return fallback;
}

async function pickInteractivePort(ports, options, rl) {
    var configured = pickConfiguredPort(ports, options);
    if (configured) return configured;

    var defaultSelection = findDefaultPort(ports, options) || pickAutomaticPort(ports, options);
    if (!process.stdin.isTTY) {
        return defaultSelection;
    }

    var defaultIndex = ports.findIndex(function(port) {
        return port.name === defaultSelection.port;
    });
    var answer = await question(
        rl,
        "Select MIDI " + options.label + " [" + defaultIndex + ": " + defaultSelection.port + "]: "
    );
    var trimmed = answer.trim();
    if (!trimmed) {
        return { port: defaultSelection.port, reason: "interactive default: " + defaultSelection.port };
    }

    var selected = resolvePortRequest(ports, trimmed, { label: "interactive " + options.label });
    if (selected) return selected;

    console.warn("MIDI " + options.label + " selection not found, using default:", defaultSelection.port);
    return defaultSelection;
}

async function main() {
    logServiceVersions();
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    var inputSelection;
    var outputSelection;
    var safeReset = false;
    var meterAudioChannels = parseMeterAudioChannels(process.env.O1V_METER_AUDIO_CHANNELS || "");
    var meterAudioDeviceName = process.env.O1V_METER_AUDIO_DEVICE || "";
    var optionalInputBankEnabled = parseYesNoAnswer(process.env.O1V_OPTIONAL_INPUT_BANK || "", false);
    var auxPrePost = defaultAuxPrePostModes();
    var mixerProfile = MIXER_PROFILES[0];
    var workspace = null;
    var appMode = "assist";
    var savedAsioMeter = null;

    try {
        var acceptedStartup = false;
        while (!acceptedStartup) {
            inputSelection = null;
            outputSelection = null;
            safeReset = false;
            meterAudioChannels = parseMeterAudioChannels(process.env.O1V_METER_AUDIO_CHANNELS || "");
            meterAudioDeviceName = process.env.O1V_METER_AUDIO_DEVICE || "";
            optionalInputBankEnabled = parseYesNoAnswer(process.env.O1V_OPTIONAL_INPUT_BANK || "", false);
            auxPrePost = defaultAuxPrePostModes();
            mixerProfile = MIXER_PROFILES[0];
            workspace = null;
            appMode = "assist";
            savedAsioMeter = null;

            var lastRunSettings = await askLoadLastRunSettings(rl);
            if (lastRunSettings) {
                savedAsioMeter = lastRunSettings.asioMeter || null;
                mixerProfile = mixerRegistry.mixerProfileById(lastRunSettings.mixerProfileId);
                mixerProfile = await pickMixerProfile(rl, mixerProfile);
                appMode = mixerStartupAppMode(mixerProfile);
                inputSelection = { port: lastRunSettings.midiInput, reason: "last run settings" };
                outputSelection = { port: lastRunSettings.midiOutput, reason: "last run settings" };
                safeReset = !!lastRunSettings.safeReset;
                meterAudioChannels = lastRunSettings.meterAudioChannels || meterAudioChannels;
                meterAudioDeviceName = lastRunSettings.meterAudioDeviceName || "";
                optionalInputBankEnabled = !!lastRunSettings.optionalInputBankEnabled;
                auxPrePost = lastRunSettings.auxPrePost || auxPrePost;
                if (mixerProfile.integration === "midi") {
                    appMode = await askAppMode(rl, appMode);
                } else {
                    console.log("\nBabyface mode: loading Festimix workspace file.");
                    workspace = loadOrCreateWorkspaceFile(mixerProfile);
                    meterAudioChannels = parseBabyfaceSoftwareInputAnswer(process.env.FESTIMIX_BABYFACE_SPECTRUM_INPUT || "3-4", meterAudioChannels);
                }
            } else {
                mixerProfile = await pickMixerProfile(rl);
                appMode = mixerStartupAppMode(mixerProfile);
                if (mixerProfile.integration === "midi") {
                    appMode = await askAppMode(rl, appMode);
                    var info = listPorts();
                    inputSelection = await pickInteractivePort(info.inputs, {
                        label: "input",
                        envName: "O1V_MIDI_INPUT",
                        indexEnvName: "O1V_MIDI_INPUT_INDEX",
                        defaultName: DEFAULT_MIDI_PORT
                    }, rl);
                    outputSelection = await pickInteractivePort(info.outputs, {
                        label: "output",
                        envName: "O1V_MIDI_OUTPUT",
                        indexEnvName: "O1V_MIDI_OUTPUT_INDEX",
                        defaultName: DEFAULT_MIDI_PORT
                    }, rl);
                }
                if (mixerProfile.integration === "midi" && process.stdin.isTTY && !process.env.FESTIMIX_MIXER_PROFILE && !process.env.MIXER_PROFILE) {
                    var resetAnswer = await question(rl, "Nullazzam a Yamaha 01V-t safe reset SysEx-szel indulaskor? [y/N]: ");
                    safeReset = resetAnswer.trim().toLowerCase() === "y" || resetAnswer.trim().toLowerCase() === "yes";
                    console.log("\nIndits merojelet azon a solo monitor audio bemeneten, amit a meterhez hasznalni akarsz.");
                    console.log("Igy konnyebb lesz a megfelelo aktiv hangkartyat/bemenetet kivalasztani.");
                    var audioInputs = listMeterAudioInputs();
                    var deviceAnswer = await question(rl, "Meter audio bemenet eszkoz [ENTER=default, index vagy nevreszlet]: ");
                    meterAudioDeviceName = pickAudioInputName(audioInputs, deviceAnswer);
                    var meterAnswer = await question(rl, "Meter audio input csatorna/par [1-2]: ");
                    meterAudioChannels = parseMeterAudioChannels(meterAnswer);
                    var optionalAnswer = await question(rl, "Van opcionális input bank / harmadik channel bank? [n]: ");
                    optionalInputBankEnabled = parseYesNoAnswer(optionalAnswer, false);
                    auxPrePost = await askAuxPrePostModes(rl, mixerProfile);
                }
                if (mixerProfile.integration === "osc") {
                    console.log("\nBabyface mode: loading Festimix workspace file.");
                    workspace = loadOrCreateWorkspaceFile(mixerProfile);
                    meterAudioChannels = parseBabyfaceSoftwareInputAnswer(process.env.FESTIMIX_BABYFACE_SPECTRUM_INPUT || "3-4", meterAudioChannels);
                }
            }
            if (mixerProfile.integration === "midi" && (!inputSelection || !inputSelection.port || !outputSelection || !outputSelection.port)) {
                var info = listPorts();
                inputSelection = await pickInteractivePort(info.inputs, {
                    label: "input",
                    envName: "O1V_MIDI_INPUT",
                    indexEnvName: "O1V_MIDI_INPUT_INDEX",
                    defaultName: DEFAULT_MIDI_PORT
                }, rl);
                outputSelection = await pickInteractivePort(info.outputs, {
                    label: "output",
                    envName: "O1V_MIDI_OUTPUT",
                    indexEnvName: "O1V_MIDI_OUTPUT_INDEX",
                    defaultName: DEFAULT_MIDI_PORT
                }, rl);
            }
            var previewInput = inputSelection && inputSelection.port;
            var previewOutput = outputSelection && outputSelection.port;
            var previewProfile = process.env.O1V_MIDI_PROFILE || mixerProfile.id;
            var previewChannel = parseInt(process.env.O1V_MIDI_CHANNEL || "1", 10);
            var previewAsioMeter = parseAsioMeterConfig(meterAudioChannels, savedAsioMeter);
            acceptedStartup = await confirmStartupSettings(rl, {
                mixerProfile: mixerProfile,
                appMode: appMode,
                input: previewInput,
                output: previewOutput,
                inputReason: inputSelection && inputSelection.reason,
                outputReason: outputSelection && outputSelection.reason,
                profile: previewProfile,
                channel: previewChannel,
                meterAudioDeviceName: meterAudioDeviceName,
                meterAudioChannels: meterAudioChannels,
                optionalInputBankEnabled: optionalInputBankEnabled,
                auxPrePost: auxPrePost,
                safeReset: safeReset,
                asioMeter: previewAsioMeter,
                workspaceFile: mixerProfile.workspaceFile
            });
            if (!acceptedStartup) {
                console.log("\nRendben, kezdjuk ujra az inditasi beallitasokat.");
            }
        }
    } finally {
        rl.close();
    }

    var input = inputSelection && inputSelection.port;
    var output = outputSelection && outputSelection.port;
    var port = parseInt(process.env.PORT || process.env.O1V_WEB_PORT || "3000", 10);
    var profile = process.env.O1V_MIDI_PROFILE || mixerProfile.controlProfile || mixerProfile.id;
    var channel = parseInt(process.env.O1V_MIDI_CHANNEL || "1", 10);
    var asioMeterConfig = parseAsioMeterConfig(meterAudioChannels, savedAsioMeter);

    logStartupSettings({
        mixerProfile: mixerProfile,
        appMode: appMode,
        input: input,
        output: output,
        inputReason: inputSelection && inputSelection.reason,
        outputReason: outputSelection && outputSelection.reason,
        profile: profile,
        channel: channel,
        meterAudioDeviceName: meterAudioDeviceName,
        meterAudioChannels: meterAudioChannels,
        optionalInputBankEnabled: optionalInputBankEnabled,
        auxPrePost: auxPrePost,
        safeReset: safeReset,
        asioMeter: asioMeterConfig,
        workspaceFile: mixerProfile.workspaceFile
    }, "Selected startup settings");
    writeLastRunSettings({
        mixerProfileId: mixerProfile.id,
        mixerProfile: { id: mixerProfile.id, label: mixerProfile.label, integration: mixerProfile.integration },
        midiInput: input,
        midiOutput: output,
        meterAudioDeviceName: meterAudioDeviceName,
        meterAudioChannels: meterAudioChannels,
        optionalInputBankEnabled: optionalInputBankEnabled,
        auxPrePost: auxPrePost,
        safeReset: safeReset,
        appMode: appMode,
        midiProfile: profile,
        midiChannel: channel,
        asioMeter: asioMeterConfig,
        workspaceFile: mixerProfile.workspaceFile
    });

    var result = midiApp.connectOutport(input, output, port, {
        profile: profile,
        channel: channel,
        safeReset: safeReset,
        meterAudioChannels: meterAudioChannels,
        meterAudioDeviceName: meterAudioDeviceName,
        optionalInputBankEnabled: optionalInputBankEnabled,
        auxPrePost: auxPrePost,
        appMode: appMode,
        mixerProfile: mixerProfile,
        integration: mixerProfile.integration,
        asioMeter: asioMeterConfig,
        workspace: workspace
    });
    if (result === 1) {
        console.error("Unable to open selected MIDI device.");
        process.exitCode = 1;
    } else {
        console.log("Festimix running at http://localhost:" + port);
    }
}

main().catch(function(error) {
    console.error(error.message || error);
    process.exitCode = 1;
});
