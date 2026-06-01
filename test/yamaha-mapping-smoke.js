"use strict";

var assert = require("assert");
var mappingModule = require("../lib/midi/mappingEngine");
var mapping = require("../yamaha01v.mapping_v3.json");

var engine = new mappingModule.MappingEngine(mapping);

function hex(message) {
    return message.bytes.map(function(byte) {
        return byte.toString(16).padStart(2, "0").toUpperCase();
    }).join(" ");
}

function assertParameter(parameterId, value, expected) {
    assert.strictEqual(hex(engine.parameterMessage(parameterId, value)), expected, parameterId);
}

function assertSelect(channel, expected) {
    var packets = engine.selectChannelPackets(channel);
    assert.strictEqual(packets.length, 1, "select packet count for " + channel);
    assert.strictEqual(packets[0].map(function(byte) {
        return byte.toString(16).padStart(2, "0").toUpperCase();
    }).join(" "), expected, "select " + channel);
}

function assertNoSelect(channel) {
    assert.strictEqual(engine.selectChannelPackets(channel).length, 0, "select packets disabled for " + channel);
}

function assertMasterBusSelect(mode, expected) {
    var packets = engine.selectMasterBusPackets(mode);
    assert.deepStrictEqual(packets.map(function(packet) {
        return packet.map(function(byte) {
            return byte.toString(16).padStart(2, "0").toUpperCase();
        }).join(" ");
    }), expected, "master bus select " + mode);
}

function assertNoMasterBusSelect(mode) {
    assert.deepStrictEqual(engine.selectMasterBusPackets(mode), [], "master bus selector must not send MIDI for " + mode);
}

function assertEqWrite(channel, band, parameter, value, expected) {
    assert.strictEqual(engine.eqWritePacket(channel, band, parameter, value).map(function(byte) {
        return byte.toString(16).padStart(2, "0").toUpperCase();
    }).join(" "), expected, [channel, band, parameter, value].join(" "));
}

function assertIncoming(message, expected) {
    var events = engine.incomingEvents(message, 1);
    assert.strictEqual(events.length, 1, "incoming event count");
    Object.keys(expected).forEach(function(key) {
        assert.deepStrictEqual(events[0][key], expected[key], "incoming " + key);
    });
}

function assertNoIncoming(message, label) {
    var events = engine.incomingEvents(message, 1);
    assert.strictEqual(events.length, 0, label || "unexpected incoming event");
}

assertSelect(1, "F0 43 10 3E 04 23 01 00 03 00 F7");
assertSelect("CH15_16", "F0 43 10 3E 04 23 01 0D 03 00 F7");
assertSelect("RTN1", "F0 43 10 3E 04 23 01 0E 03 00 F7");
assertSelect("RTN2", "F0 43 10 3E 04 23 01 0F 03 00 F7");
assertSelect("STEREO", "F0 43 10 3E 04 23 01 16 03 00 F7");
assertNoMasterBusSelect("MIX");
assertNoMasterBusSelect("AUX1");
assertNoMasterBusSelect("AUX2");
assertNoMasterBusSelect("AUX3");
assertNoMasterBusSelect("AUX4");
assertNoMasterBusSelect("EFF1");
assertNoMasterBusSelect("EFF2");

assertParameter("pan.1", 0x00, "F0 43 10 3E 04 30 06 60 00 F7");
assertParameter("pan.1", 0x10, "F0 43 10 3E 04 30 06 60 10 F7");
assertParameter("pan.1", 0x20, "F0 43 10 3E 04 30 06 60 20 F7");
assertParameter("pan.12", 0x10, "F0 43 10 3E 04 30 06 6B 10 F7");
assertParameter("pan.CH13_L", 0x00, "F0 43 10 3E 04 30 06 74 00 F7");
assertParameter("pan.CH13_R", 0x20, "F0 43 10 3E 04 30 06 75 20 F7");
assertParameter("pan.CH15_L", 0x00, "F0 43 10 3E 04 30 06 76 00 F7");
assertParameter("pan.CH15_R", 0x20, "F0 43 10 3E 04 30 06 77 20 F7");
assertParameter("pan.RTN1_L", 0x00, "F0 43 10 3E 04 30 06 78 00 F7");
assertParameter("pan.RTN1_R", 0x20, "F0 43 10 3E 04 30 06 79 20 F7");
assertParameter("pan.RTN2_L", 0x00, "F0 43 10 3E 04 30 06 7A 00 F7");
assertParameter("pan.RTN2_R", 0x20, "F0 43 10 3E 04 30 06 7B 20 F7");
assert.strictEqual(engine.ccForParameter("masterFader.effect2"), 25, "EFF1 logical master CC");
assert.strictEqual(engine.ccForParameter("masterFader.effect1"), 26, "EFF2 logical master CC");
assertParameter("attenuator.1.level", 0x60, "F0 43 10 3E 04 30 07 56 60 F7");
assertParameter("attenuator.1.level", 0x00, "F0 43 10 3E 04 30 07 56 00 F7");
assertParameter("attenuator.CH13_14.level", 0x60, "F0 43 10 3E 04 30 07 62 60 F7");
assertParameter("attenuator.CH15_16.level", 0x60, "F0 43 10 3E 04 30 07 63 60 F7");
assertParameter("fx2Send.1", 0x40, "F0 43 10 3E 04 30 00 57 40 F7");
assertParameter("fx1Send.1", 0x40, "F0 43 10 3E 04 30 00 63 40 F7");
assertEqWrite(1, "LOW", "Q_OR_TYPE", 0x28, "F0 43 10 3E 04 30 03 50 28 F7");
assertEqWrite(1, "LOW", "Q_OR_TYPE", 0x29, "F0 43 10 3E 04 30 03 50 29 F7");
assertEqWrite(1, "LOW", "Q_OR_TYPE", 0x2c, "F0 43 10 3E 04 30 03 50 2C F7");
assertEqWrite(1, "HIGH", "Q_OR_TYPE", 0x28, "F0 43 10 3E 04 30 04 12 28 F7");
assertEqWrite(1, "HIGH", "Q_OR_TYPE", 0x2a, "F0 43 10 3E 04 30 04 12 2A F7");
assertEqWrite(1, "HIGH", "Q_OR_TYPE", 0x2b, "F0 43 10 3E 04 30 04 12 2B F7");

assertIncoming([0xB0, 0x01, 0x40], {
    transport: "cc",
    group: "channelFader",
    target: "CH1",
    channelId: "1",
    value: 0x40
});
assertIncoming([0xB0, 0x5B, 0x40], {
    transport: "cc",
    group: "fx1Send",
    target: "CH1",
    channelId: "1",
    value: 0x40
});
assertIncoming([0xB0, 0x1C, 0x7F], {
    transport: "cc",
    group: "channelOn",
    target: "CH1",
    channelId: "1",
    enabled: true
});
assertIncoming([0xB0, 0x2D, 0x7F], {
    transport: "cc",
    group: "masterOn",
    target: "AUX1",
    masterId: "aux1",
    enabled: true
});
assertIncoming([0xB0, 0x19, 0x00], {
    transport: "cc",
    group: "masterFader",
    target: "EFFECT2",
    masterId: "effect2",
    value: 0
});
assertIncoming([0xB0, 0x1A, 0x00], {
    transport: "cc",
    group: "masterFader",
    target: "EFFECT1",
    masterId: "effect1",
    value: 0
});
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x43, 0x00, 0x64, 0x08, 0xF7], "key-remote solo press is not state");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x43, 0x00, 0x64, 0x08], "key-remote solo press without F7 is not state");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x43, 0x00, 0x64, 0x00, 0xF7], "key-remote solo release is not state");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x43, 0x00, 0x65, 0x0C, 0xF7], "key-remote stereo solo press is not state");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x43, 0x00, 0x65, 0x0D, 0xF7], "key-remote stereo solo press is not state");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x43, 0x00, 0x65, 0x0E, 0xF7], "key-remote return solo press is not state");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x23, 0x01, 0x06, 0x10, 0x00, 0xF7], "HOME/fader status is not channel select");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x23, 0x01, 0x06, 0x01, 0x04, 0xF7], "MIDI page status is not channel select");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x23, 0x01, 0x01, 0x10, 0x02, 0xF7], "fader mode status is not channel select");
assertNoIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x23, 0x01, 0x01, 0x0C, 0x00, 0xF7], "page status is not channel select");
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x10, 0x0E, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "RTN1",
    channelId: "RTN1",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x10, 0x08, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "CH9",
    channelId: "9",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x10, 0x00, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "CH9",
    channelId: "9",
    enabled: false
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x10, 0x0E], {
    transport: "sysex",
    group: "channelSolo",
    target: "RTN1",
    channelId: "RTN1",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x0F, 0x08, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "CH1",
    channelId: "1",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x0F, 0x00, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "CH1",
    channelId: "1",
    enabled: false
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x0F, 0x0D, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "CH6",
    channelId: "6",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x0F, 0x05, 0xF7], {
    transport: "sysex",
    group: "channelSolo",
    target: "CH6",
    channelId: "6",
    enabled: false
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x0D, 0x08, 0xF7], {
    transport: "sysex",
    group: "masterSolo",
    target: "STEREO",
    masterId: "stereo",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x61, 0x00, 0x0E, 0x09, 0xF7], {
    transport: "sysex",
    group: "masterSolo",
    target: "AUX2",
    masterId: "aux2",
    enabled: true
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x00, 0x0C, 0x40, 0xF7], {
    transport: "sysex",
    group: "channelFader",
    target: "CH1",
    channelId: "1",
    value: 0x40
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x02, 0x78, 0x24, 0xF7], {
    transport: "sysex",
    group: "rawEq",
    target: "1",
    channelId: "1",
    band: "LOW",
    control: "gain",
    value: 0x24
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x00, 0x27, 0x40, 0xF7], {
    transport: "sysex",
    group: "auxSend",
    aux: "AUX1",
    target: "CH1",
    channelId: "1",
    value: 0x40
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x00, 0x57, 0x40, 0xF7], {
    transport: "sysex",
    group: "fx2Send",
    target: "CH1",
    channelId: "1",
    value: 0x40
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x00, 0x63, 0x40, 0xF7], {
    transport: "sysex",
    group: "fx1Send",
    target: "CH1",
    channelId: "1",
    value: 0x40
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x00, 0x1A, 0x40, 0xF7], {
    transport: "sysex",
    group: "effectReturnSend",
    bus: "master",
    target: "effRtn1",
    channelId: "RTN1",
    value: 0x40
});
assertIncoming([0xF0, 0x43, 0x10, 0x3E, 0x04, 0x30, 0x07, 0x56, 0x5F, 0xF7], {
    transport: "sysex",
    group: "attenuator",
    target: "CH1",
    channelId: "1",
    value: 0x5F
});

console.log("yamaha mapping smoke ok");
