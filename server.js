"use strict";

var JZZ = require("jzz");
var readline = require("readline");
var midiApp = require("./app");

var DEFAULT_MIDI_PORT = "Babyface Midi Port 1";

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
    var info = listPorts();
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    var inputSelection;
    var outputSelection;
    var safeReset = false;
    var meterAudioChannels = parseMeterAudioChannels(process.env.O1V_METER_AUDIO_CHANNELS || "");

    try {
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
        if (process.stdin.isTTY) {
            var resetAnswer = await question(rl, "Nullazzam a Yamaha 01V-t safe reset SysEx-szel indulaskor? [y/N]: ");
            safeReset = resetAnswer.trim().toLowerCase() === "y" || resetAnswer.trim().toLowerCase() === "yes";
            var meterAnswer = await question(rl, "Meter audio input csatorna/par [1-2]: ");
            meterAudioChannels = parseMeterAudioChannels(meterAnswer);
        }
    } finally {
        rl.close();
    }

    var input = inputSelection.port;
    var output = outputSelection.port;
    var port = parseInt(process.env.PORT || process.env.O1V_WEB_PORT || "3000", 10);
    var profile = process.env.O1V_MIDI_PROFILE || "yamaha01vDefault";
    var channel = parseInt(process.env.O1V_MIDI_CHANNEL || "1", 10);

    console.log("\nSelected MIDI input:", input);
    console.log("  reason:", inputSelection.reason);
    console.log("Selected MIDI output:", output);
    console.log("  reason:", outputSelection.reason);
    console.log("Selected MIDI profile:", profile);
    console.log("Selected MIDI channel:", channel);
    console.log("Selected meter audio channels:", meterAudioChannels.label);
    console.log("Startup safe reset:", safeReset ? "YES" : "NO");

    var result = midiApp.connectOutport(input, output, port, { profile: profile, channel: channel, safeReset: safeReset, meterAudioChannels: meterAudioChannels });
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
