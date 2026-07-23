var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var VK = {
    playpause: 0xb3,
    next: 0xb0,
    previous: 0xb1
};

function isSupported() {
    return process.platform === "win32";
}

function run(command, args, callback) {
    childProcess.execFile(command, args || [], { windowsHide: true }, function(error, stdout, stderr) {
        callback(error, stdout || "", stderr || "");
    });
}

function disabledStatus() {
    return {
        supported: false,
        spotifyRunning: false,
        disabledReason: "windows-only"
    };
}

function isSpotifyRunning(callback) {
    if (!isSupported()) return callback(null, false);
    run("tasklist.exe", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], function(error, stdout) {
        if (error) return callback(error);
        callback(null, /Spotify\.exe/i.test(stdout));
    });
}

function statusFromRunning(running) {
    return {
        supported: isSupported(),
        spotifyRunning: !!running,
        playbackStatus: null,
        isPlaying: false,
        disabledReason: isSupported() ? null : "windows-only"
    };
}

function getStatus(callback) {
    if (!isSupported()) return callback(null, disabledStatus());
    isSpotifyRunning(function(error, running) {
        if (error) return callback(error);
        if (!running) return callback(null, statusFromRunning(false));
        getPlaybackStatus(function(statusError, playbackStatus) {
            var status = statusFromRunning(true);
            if (!statusError && playbackStatus) {
                status.playbackStatus = playbackStatus;
                status.isPlaying = playbackStatus === "Playing";
            }
            callback(null, status);
        });
    });
}

function getPlaybackStatus(callback) {
    if (!isSupported()) return callback(null, null);
    var script = [
        "try {",
        "Add-Type -AssemblyName System.Runtime.WindowsRuntime;",
        "$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime];",
        "$method = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 })[0];",
        "$asTask = $method.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]);",
        "$manager = $asTask.Invoke($null, @([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())).Result;",
        "$session = $manager.GetCurrentSession();",
        "if ($session -eq $null) { ''; exit 0 }",
        "$session.GetPlaybackInfo().PlaybackStatus.ToString();",
        "} catch { '' }"
    ].join(" ");
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], function(error, stdout) {
        if (error) return callback(error);
        callback(null, String(stdout || "").trim() || null);
    });
}

function fallbackSpotifyPath() {
    var appData = process.env.APPDATA || "";
    return appData ? path.join(appData, "Spotify", "Spotify.exe") : "";
}

function launchSpotify(callback) {
    if (!isSupported()) return callback(null, disabledStatus());
    isSpotifyRunning(function(error, running) {
        if (error) return callback(error);
        if (running) return callback(null, Object.assign(statusFromRunning(true), { launched: false }));
        run("cmd.exe", ["/c", "start", "", "spotify:"], function(startError) {
            if (!startError) return callback(null, Object.assign(statusFromRunning(false), { launched: true }));
            var fallback = fallbackSpotifyPath();
            if (!fallback || !fs.existsSync(fallback)) return callback(startError);
            childProcess.spawn(fallback, [], {
                detached: true,
                stdio: "ignore",
                windowsHide: true
            }).unref();
            callback(null, Object.assign(statusFromRunning(false), { launched: true, fallback: true }));
        });
    });
}

function sendMediaKey(key, callback) {
    if (!isSupported()) return callback(null, disabledStatus());
    var vk = VK[key];
    if (!vk) return callback(new Error("Unsupported media key: " + key));
    var script = [
        "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MediaKeys { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo); }';",
        "[MediaKeys]::keybd_event(" + vk + ", 0, 0, 0);",
        "[MediaKeys]::keybd_event(" + vk + ", 0, 2, 0);"
    ].join(" ");
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], function(error) {
        if (error) return callback(error);
        getStatus(function(statusError, status) {
            if (statusError) return callback(statusError);
            callback(null, Object.assign(status, { sent: key }));
        });
    });
}

module.exports = {
    isSupported: isSupported,
    getStatus: getStatus,
    isSpotifyRunning: isSpotifyRunning,
    launchSpotify: launchSpotify,
    playPause: function(callback) { sendMediaKey("playpause", callback); },
    next: function(callback) { sendMediaKey("next", callback); },
    previous: function(callback) { sendMediaKey("previous", callback); }
};
