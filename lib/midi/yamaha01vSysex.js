"use strict";

function parseAddress(address) {
    if (typeof address === "number") return address;
    if (!address) return null;
    var text = String(address).trim().toLowerCase();
    if (text.indexOf("0x") === 0) return parseInt(text, 16);
    return parseInt(text, 16);
}

function byteToNibbles(value) {
    var byteValue = Math.max(0, Math.min(255, parseInt(value, 10)));
    return [(byteValue >> 4) & 0x0f, byteValue & 0x0f];
}

function addressTo7BitPair(address) {
    var parsed = parseAddress(address);
    if (parsed === null || isNaN(parsed)) {
        throw new Error("A valid 01V edit-buffer address is required.");
    }
    if (parsed < 0 || parsed > 0x3fff) {
        throw new Error("01V edit-buffer address out of 14-bit range.");
    }
    return [(parsed >> 7) & 0x7f, parsed & 0x7f];
}

function formatBytes(bytes) {
    return bytes.map(function(byte) {
        return byte.toString(16).toUpperCase().padStart(2, "0");
    }).join(" ");
}

function buildEditBufferByteChange(deviceChannelIndex, address, value) {
    var addr = addressTo7BitPair(address);
    var data = byteToNibbles(value);
    return [
        0xf0,
        0x43,
        0x10 + deviceChannelIndex,
        0x3e,
        0x04,
        0x00,
        addr[0],
        addr[1],
        data[0],
        data[1],
        0xf7
    ];
}

function buildParameterChange30(deviceChannelIndex, address, value) {
    var addr = addressTo7BitPair(address);
    return [
        0xf0,
        0x43,
        0x10 + deviceChannelIndex,
        0x3e,
        0x04,
        0x30,
        addr[0],
        addr[1],
        Math.max(0, Math.min(127, parseInt(value, 10))),
        0xf7
    ];
}

function eqGainDbToByte(gainDb) {
    var gain = parseFloat(gainDb);
    if (isNaN(gain)) gain = 0;
    gain = Math.max(-18, Math.min(18, gain));
    return Math.round((gain + 18) * 2);
}

module.exports = {
    buildEditBufferByteChange: buildEditBufferByteChange,
    buildParameterChange30: buildParameterChange30,
    eqGainDbToByte: eqGainDbToByte,
    formatBytes: formatBytes,
    parseAddress: parseAddress
};
