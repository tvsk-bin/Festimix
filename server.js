"use strict";

var JZZ = require("jzz");
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var readline = require("readline");
var midiApp = require("./app");

var DEFAULT_MIDI_PORT = "Babyface Midi Port 1";
var SERVER_VERSION = "2.1.0";
var lastRunSettingsPath = path.join(__dirname, "data", "last-run-settings.json");
var MIXER_PROFILES = [
    { id: "yamaha01vDefault", label: "Yamaha 01V", integration: "midi", engineProfile: "yamaha01v" },
    { id: "rmeBabyfaceOsc", label: "RME Babyface", integration: "osc", engineProfile: "rmeBabyface", defaultWorkspace: "12-4-2 live mixer.tmws" }
];
var RME_BABYFACE_CONFIG = {
    id: "rmeBabyfaceOsc",
    label: "RME Babyface OSC",
    routing: {
        hardwareInputs: "CH1-12",
        softwarePlayback: "CH13/14-CH15/16",
        masterOut: "1/2",
        soloOut: "Phones 3/4",
        auxOuts: { aux1: "5", aux2: "6", aux3: "7", aux4: "8" }
    },
    eq: {
        gainRange: [-20, 20],
        qRange: [0.7, 5],
        hpfRange: [20, 500],
        lowBandMode: "HPF frequency only"
    },
    effects: {
        effect1: ["SMALL", "MED", "LARGE", "WALLS"],
        effect2: ["STEREO", "CROSS", "PONG"]
    }
};

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
    console.log("\nFestimix service versions:");
    console.log("  server:", "Festimix " + SERVER_VERSION + " (TVSK 2026)");
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

function mixerProfileById(id) {
    return MIXER_PROFILES.find(function(profile) { return profile.id === id; }) || MIXER_PROFILES[0];
}

function defaultWorkspacePath(profile) {
    var configured = process.env.O1V_DEFAULT_WORKSPACE || (profile && profile.defaultWorkspace);
    if (!configured) return "";
    if (path.isAbsolute(configured)) return configured;
    return path.join(process.env.USERPROFILE || "", "Documents", configured);
}

function listSnapshotFiles() {
    var documents = path.join(process.env.USERPROFILE || "", "Documents");
    try {
        if (!fs.existsSync(documents)) return [];
        return fs.readdirSync(documents)
            .filter(function(name) { return /\.tmss$/i.test(name); })
            .sort()
            .map(function(name) { return path.join(documents, name); });
    } catch (error) {
        console.warn("Snapshot list read failed:", error.message);
        return [];
    }
}

function startupConfigForProfile(profile) {
    var workspacePath = defaultWorkspacePath(profile);
    return {
        workspacePath: workspacePath,
        workspaceExists: !!(workspacePath && fs.existsSync(workspacePath)),
        startupMode: process.env.FESTIMIX_STARTUP_MODE || "default",
        snapshotPath: process.env.FESTIMIX_SNAPSHOT || ""
    };
}

function openAssociatedFile(filePath, label) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
        if (process.platform === "win32") {
            childProcess.spawn("cmd.exe", ["/c", "start", "", filePath], { detached: true, stdio: "ignore" }).unref();
        } else {
            childProcess.spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" }).unref();
        }
        console.log("Opened " + label + ":", filePath);
        return true;
    } catch (error) {
        console.warn("Could not open " + label + ":", error.message);
        return false;
    }
}

function summarizeLastRunSettings(settings) {
    if (!settings) return;
    console.log("\nLast run settings:");
    console.log("  mixer:", (settings.mixerProfile && settings.mixerProfile.label) || settings.mixerProfileId || "unknown");
    console.log("  midi input:", settings.midiInput || "default");
    console.log("  midi output:", settings.midiOutput || "default");
    console.log("  meter audio:", settings.meterAudioDeviceName || "default", "channels", (settings.meterAudioChannels && settings.meterAudioChannels.label) || "1-2");
    console.log("  optional input bank:", settings.optionalInputBankEnabled ? "YES" : "NO");
    console.log("  aux pre/post:", JSON.stringify(settings.auxPrePost || defaultAuxPrePostModes()));
    console.log("  safe reset:", settings.safeReset ? "YES" : "NO");
    if (settings.startupConfig) {
        console.log("  workspace:", settings.startupConfig.workspacePath || "none");
        console.log("  startup mode:", settings.startupConfig.startupMode || "default");
        console.log("  snapshot:", settings.startupConfig.snapshotPath || "none");
    }
}

async function askLoadLastRunSettings(rl) {
    if (process.env.FESTIMIX_SKIP_LAST_RUN === "1") return null;
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

async function askAuxPrePostModes(rl, mixerProfile) {
    if (!process.stdin.isTTY || !mixerProfile || mixerProfile.id !== "yamaha01vDefault") {
        return {};
    }
    var result = defaultAuxPrePostModes();
    console.log("\nYamaha 01V AUX send pre/post startup beallitas:");
    console.log("  Gyari alap: POST. Monitor hasznalathoz ajanlott: PRE.");
    console.log("  PRE valasztasnal az adott AUX osszes input csatornajat 1-16 atkapcsolom.");
    for (var aux = 1; aux <= 4; aux++) {
        var answer = await question(rl, "AUX" + aux + " legyen pre vagy post? [pre]: ");
        result["AUX" + aux] = parsePrePostAnswer(answer);
    }
    return result;
}

async function pickMixerProfile(rl) {
    console.log("\nMixer tipus:");
    var defaultProfile = mixerProfileById(process.env.FESTIMIX_DEFAULT_MIXER || "");
    var defaultIndex = MIXER_PROFILES.findIndex(function(profile) { return profile.id === defaultProfile.id; });
    if (defaultIndex < 0) defaultIndex = 0;
    MIXER_PROFILES.forEach(function(profile, index) {
        console.log("  [" + index + "] " + profile.label + " (" + profile.integration + ")");
    });
    if (!process.stdin.isTTY) return MIXER_PROFILES[defaultIndex];
    var answer = await question(rl, "Valassz mixer tipust [" + defaultIndex + ": " + MIXER_PROFILES[defaultIndex].label + "]: ");
    if (!answer.trim()) return MIXER_PROFILES[defaultIndex];
    var index = parseInt(answer.trim(), 10);
    if (!isNaN(index) && MIXER_PROFILES[index]) return MIXER_PROFILES[index];
    return MIXER_PROFILES[defaultIndex];
}

async function askRmeStartupConfig(rl, profile) {
    var config = startupConfigForProfile(profile);
    console.log("\nRME Babyface OSC inditas:");
    console.log("  Routing: master 1/2, solo Phones 3/4, AUX 5/6/7/8.");
    console.log("  Figyelmeztetes: legyen bekapcsolva az adat extender (Behringer ADA vagy mas).");
    console.log("  Workspace: " + config.workspacePath + (config.workspaceExists ? " [OK]" : " [NEM TALALHATO]"));
    if (!config.workspaceExists) {
        console.warn("  A workspace fajlt kesobb kezzel kell betolteni vagy a path-t javitani.");
    }
    if (!process.stdin.isTTY) return config;
    var modeAnswer = await question(rl, "Default induljon vagy snapshot? [default/snapshot]: ");
    var mode = String(modeAnswer || "").trim().toLowerCase();
    config.startupMode = mode === "snapshot" ? "snapshot" : "default";
    if (config.startupMode === "default") {
        console.log("  RME default reset meg nincs definialva; egyelore nem kuldok reset parancsot.");
        return config;
    }
    var snapshots = listSnapshotFiles();
    if (!snapshots.length) {
        console.log("  Nem talaltam .tmss snapshot fajlt a Documents mappaban.");
        var manual = await question(rl, "Snapshot teljes path vagy ENTER kesobbre: ");
        config.snapshotPath = manual.trim();
        return config;
    }
    console.log("\nTotalMix snapshotok a Documents mappaban:");
    snapshots.forEach(function(snapshot, index) {
        console.log("  [" + index + "] " + path.basename(snapshot));
    });
    var answer = await question(rl, "Valassz snapshotot [0], vagy irj teljes path-t: ");
    var trimmed = answer.trim();
    var index = parseInt(trimmed, 10);
    config.snapshotPath = !trimmed ? snapshots[0] : (!isNaN(index) && snapshots[index] ? snapshots[index] : trimmed);
    return config;
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
    var auxPrePost = {};
    var mixerProfile = MIXER_PROFILES[0];
    var startupConfig = null;

    try {
        var lastRunSettings = await askLoadLastRunSettings(rl);
        if (lastRunSettings) {
            mixerProfile = mixerProfileById(lastRunSettings.mixerProfileId);
            inputSelection = { port: lastRunSettings.midiInput, reason: "last run settings" };
            outputSelection = { port: lastRunSettings.midiOutput, reason: "last run settings" };
            safeReset = !!lastRunSettings.safeReset;
            meterAudioChannels = lastRunSettings.meterAudioChannels || meterAudioChannels;
            meterAudioDeviceName = lastRunSettings.meterAudioDeviceName || "";
            optionalInputBankEnabled = !!lastRunSettings.optionalInputBankEnabled;
            auxPrePost = lastRunSettings.auxPrePost || auxPrePost;
            startupConfig = lastRunSettings.startupConfig || startupConfigForProfile(mixerProfile);
        } else {
            mixerProfile = process.env.FESTIMIX_MIXER_PROFILE ? mixerProfileById(process.env.FESTIMIX_MIXER_PROFILE) : await pickMixerProfile(rl);
            if (mixerProfile.integration === "midi") {
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
            if (mixerProfile.integration === "osc") {
                startupConfig = await askRmeStartupConfig(rl, mixerProfile);
            }
            if (process.stdin.isTTY) {
                if (mixerProfile.integration === "midi") {
                    var resetAnswer = await question(rl, "Nullazzam a Yamaha 01V-t safe reset SysEx-szel indulaskor? [y/N]: ");
                    safeReset = resetAnswer.trim().toLowerCase() === "y" || resetAnswer.trim().toLowerCase() === "yes";
                }
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
    } finally {
        rl.close();
    }

    var input = inputSelection && inputSelection.port;
    var output = outputSelection && outputSelection.port;
    var port = parseInt(process.env.PORT || process.env.O1V_WEB_PORT || "3000", 10);
    var profile = process.env.O1V_MIDI_PROFILE || mixerProfile.id;
    var channel = parseInt(process.env.O1V_MIDI_CHANNEL || "1", 10);
    startupConfig = startupConfig || startupConfigForProfile(mixerProfile);

    console.log("\nSelected mixer:", mixerProfile.label);
    console.log("Selected integration:", mixerProfile.integration);
    if (mixerProfile.integration === "midi") {
        console.log("Selected MIDI input:", input);
        console.log("  reason:", inputSelection.reason);
        console.log("Selected MIDI output:", output);
        console.log("  reason:", outputSelection.reason);
    }
    console.log("Selected MIDI profile:", profile);
    console.log("Selected MIDI channel:", channel);
    console.log("Selected meter audio device:", meterAudioDeviceName || "default");
    console.log("Selected meter audio channels:", meterAudioChannels.label);
    console.log("Optional input bank:", optionalInputBankEnabled ? "YES" : "NO");
    if (mixerProfile.integration === "osc") {
        console.log("Selected workspace:", startupConfig.workspacePath || "none", startupConfig.workspaceExists ? "[OK]" : "[NEM TALALHATO]");
        console.log("Selected startup mode:", startupConfig.startupMode);
        if (startupConfig.snapshotPath) console.log("Selected snapshot:", startupConfig.snapshotPath);
    }
    if (mixerProfile.id === "yamaha01vDefault") {
        console.log("Selected AUX pre/post startup:", JSON.stringify(auxPrePost));
    }
    console.log("Startup safe reset:", safeReset ? "YES" : "NO");
    if (mixerProfile.integration === "osc") {
        openAssociatedFile(startupConfig.workspacePath, "TotalMix workspace");
        if (startupConfig.startupMode === "snapshot") {
            openAssociatedFile(startupConfig.snapshotPath, "TotalMix snapshot");
        }
    }
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
        midiProfile: profile,
        midiChannel: channel,
        startupConfig: startupConfig
    });

    var mixerConfig = mixerProfile.id === "rmeBabyfaceOsc" ? RME_BABYFACE_CONFIG : null;
    var result = midiApp.connectOutport(input, output, port, { profile: profile, channel: channel, integration: mixerProfile.integration, engineProfile: mixerProfile.engineProfile, mixerProfileId: mixerProfile.id, mixerProfileLabel: mixerProfile.label, mixerConfig: mixerConfig, startupConfig: startupConfig, safeReset: safeReset, meterAudioChannels: meterAudioChannels, meterAudioDeviceName: meterAudioDeviceName, optionalInputBankEnabled: optionalInputBankEnabled, auxPrePost: auxPrePost });
    if (result === 1) {
        console.error("Unable to open selected MIDI device.");
        process.exitCode = 1;
    } else {
        console.log("01V Web Controller running at http://localhost:" + port);
    }
}

main().catch(function(error) {
    console.error(error.message || error);
    process.exitCode = 1;
});
