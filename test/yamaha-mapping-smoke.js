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

assertSelect(1, "F0 43 10 3E 04 23 01 00 10 00 F7");
assertSelect("CH15_16", "F0 43 10 3E 04 23 01 0D 10 00 F7");
assertSelect("RTN1", "F0 43 10 3E 04 23 01 0E 10 00 F7");
assertSelect("RTN2", "F0 43 10 3E 04 23 01 0F 10 00 F7");

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

console.log("yamaha mapping smoke ok");
