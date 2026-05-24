package com.festimix.osc;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class OscMessage {
    private final String address;
    private final List<Object> arguments;

    public OscMessage(String address, List<Object> arguments) {
        if (address == null || address.isBlank() || !address.startsWith("/")) {
            throw new IllegalArgumentException("OSC address must start with '/': " + address);
        }
        this.address = address;
        this.arguments = List.copyOf(arguments == null ? List.of() : arguments);
    }

    public static OscMessage of(String address, Object... args) {
        List<Object> list = new ArrayList<>();
        if (args != null) for (Object arg : args) list.add(arg);
        return new OscMessage(address, list);
    }

    public byte[] toByteArray() {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            writeOscString(out, address);
            writeOscString(out, typeTags(arguments));
            for (Object arg : arguments) writeArgument(out, arg);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("OSC encoding failed", e);
        }
    }

    private static String typeTags(List<Object> args) {
        StringBuilder sb = new StringBuilder(",");
        for (Object arg : args) {
            if (arg instanceof Float || arg instanceof Double) sb.append('f');
            else if (arg instanceof Integer || arg instanceof Short || arg instanceof Byte || arg instanceof Long) sb.append('i');
            else if (arg instanceof String) sb.append('s');
            else if (arg instanceof Boolean b) sb.append(b ? 'T' : 'F');
            else throw new IllegalArgumentException("Unsupported OSC argument type: " + arg);
        }
        return sb.toString();
    }

    private static void writeArgument(ByteArrayOutputStream out, Object arg) throws IOException {
        if (arg instanceof Float f) writeInt(out, Float.floatToIntBits(f));
        else if (arg instanceof Double d) writeInt(out, Float.floatToIntBits(d.floatValue()));
        else if (arg instanceof Integer i) writeInt(out, i);
        else if (arg instanceof Short s) writeInt(out, s.intValue());
        else if (arg instanceof Byte b) writeInt(out, b.intValue());
        else if (arg instanceof Long l) writeInt(out, l.intValue());
        else if (arg instanceof String s) writeOscString(out, s);
        else if (arg instanceof Boolean) { }
        else throw new IllegalArgumentException("Unsupported OSC argument type: " + arg);
    }

    private static void writeInt(ByteArrayOutputStream out, int value) throws IOException {
        out.write(ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(value).array());
    }

    private static void writeOscString(ByteArrayOutputStream out, String s) throws IOException {
        byte[] raw = s.getBytes(StandardCharsets.UTF_8);
        out.write(raw);
        out.write(0);
        int pad = 4 - ((raw.length + 1) % 4);
        if (pad == 4) pad = 0;
        for (int i = 0; i < pad; i++) out.write(0);
    }
}
