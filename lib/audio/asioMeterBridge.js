"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var readline = require("readline");

function intOption(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
}

function normalizeAsioMeterConfig(config) {
    config = config || {};
    var inputLeftChannel = Math.max(1, intOption(config.inputLeftChannel, 3));
    var inputRightChannel = Math.max(1, intOption(config.inputRightChannel, 4));
    var sampleRate = Math.max(8000, intOption(config.sampleRate, 44100));
    var channelCount = Math.max(Math.max(inputLeftChannel, inputRightChannel), intOption(config.channelCount, 12));
    return {
        asioDriverName: config.asioDriverName || "ASIO Fireface USB",
        inputLeftChannel: inputLeftChannel,
        inputRightChannel: inputRightChannel,
        sampleRate: sampleRate,
        channelCount: channelCount,
        projectPath: config.projectPath || path.join(__dirname, "..", "..", "tools", "RmeAsioMeter", "RmeAsioMeter.csproj"),
        assemblyPath: config.assemblyPath || path.join(__dirname, "..", "..", "tools", "RmeAsioMeter", "bin", "Debug", "net8.0-windows", "RmeAsioMeter.dll")
    };
}

function AsioMeterBridge(config, onFrame) {
    this.config = normalizeAsioMeterConfig(config);
    this.onFrame = typeof onFrame === "function" ? onFrame : function() {};
    this.process = null;
    this.readline = null;
    this.started = false;
}

AsioMeterBridge.prototype.start = function() {
    if (this.process) return;
    var config = this.config;
    var meterArgs = [
        "--driver-name", config.asioDriverName,
        "--left-channel", String(config.inputLeftChannel),
        "--right-channel", String(config.inputRightChannel),
        "--sample-rate", String(config.sampleRate),
        "--channel-count", String(config.channelCount)
    ];
    var args = fs.existsSync(config.assemblyPath) ?
        [config.assemblyPath].concat(meterArgs) :
        ["run", "--project", config.projectPath, "--"].concat(meterArgs);

    this.process = childProcess.spawn("dotnet", args, {
        cwd: path.join(__dirname, "..", ".."),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    });

    this.readline = readline.createInterface({ input: this.process.stdout });
    this.readline.on("line", this.handleLine.bind(this));

    this.process.stderr.on("data", function(chunk) {
        String(chunk).split(/\r?\n/).filter(Boolean).forEach(function(line) {
            console.warn("ASIO meter:", line);
        });
    });

    this.process.on("error", function(error) {
        console.warn("ASIO meter failed to start:", error.message);
    });

    this.process.on("exit", function(code, signal) {
        console.warn("ASIO meter stopped:", signal || code);
        this.process = null;
        this.readline = null;
        this.started = false;
    }.bind(this));
};

AsioMeterBridge.prototype.stop = function() {
    if (!this.process) return;
    this.process.kill();
    this.process = null;
    this.started = false;
};

AsioMeterBridge.prototype.handleLine = function(line) {
    var message;
    try {
        message = JSON.parse(line);
    } catch (error) {
        if (line) console.warn("ASIO meter:", line);
        return;
    }

    if (!message || !message.type) return;
    if (message.type === "status") {
        this.started = true;
        console.log("ASIO meter running:", JSON.stringify(message.payload));
        return;
    }
    if (message.type === "error") {
        console.warn("ASIO meter error:", message.payload && (message.payload.message || message.payload.detail));
        return;
    }
    if (message.type === "frame" && message.payload && message.payload.data) {
        this.onFrame(message.payload);
    }
};

module.exports = {
    AsioMeterBridge: AsioMeterBridge,
    normalizeAsioMeterConfig: normalizeAsioMeterConfig
};
