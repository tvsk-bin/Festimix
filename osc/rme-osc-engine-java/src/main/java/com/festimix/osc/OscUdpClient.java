package com.festimix.osc;

import java.io.Closeable;
import java.io.IOException;
import java.net.*;

public final class OscUdpClient implements Closeable {
    private final DatagramSocket socket = new DatagramSocket();
    private InetAddress host;
    private int port;

    public OscUdpClient(String host, int port) throws UnknownHostException, SocketException {
        setTarget(host, port);
    }

    public synchronized void setTarget(String host, int port) throws UnknownHostException {
        if (host == null || host.isBlank()) throw new IllegalArgumentException("host is blank");
        if (port < 1 || port > 65535) throw new IllegalArgumentException("invalid port");
        this.host = InetAddress.getByName(host);
        this.port = port;
    }

    public void send(OscMessage msg) throws IOException {
        byte[] data = msg.toByteArray();
        socket.send(new DatagramPacket(data, data.length, host, port));
    }

    @Override public void close() { socket.close(); }
}
