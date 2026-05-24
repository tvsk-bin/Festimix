package com.festimix.osc;

import java.io.Closeable;
import java.io.IOException;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public final class OscEngine implements Closeable {
    private final OscUdpClient client;
    private final BlockingQueue<OscMessage> queue = new LinkedBlockingQueue<>(2048);
    private final ExecutorService worker;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private volatile Consumer<Exception> errorHandler = e -> {};

    public OscEngine(String host, int port) throws SocketException, UnknownHostException {
        this.client = new OscUdpClient(host, port);
        this.worker = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "osc-sender");
            t.setDaemon(true);
            return t;
        });
        worker.submit(this::run);
    }

    public void setErrorHandler(Consumer<Exception> handler) {
        this.errorHandler = handler == null ? e -> {} : handler;
    }

    public void setTarget(String host, int port) throws UnknownHostException {
        client.setTarget(host, port);
    }

    public boolean send(String path, float value) { return send(OscMessage.of(path, value)); }
    public boolean send(String path, int value) { return send(OscMessage.of(path, value)); }
    public boolean send(String path, String value) { return send(OscMessage.of(path, value)); }
    public boolean trigger(String path) { return send(path, 1.0f); }

    public boolean send(OscMessage msg) {
        if (!running.get()) return false;
        return queue.offer(msg);
    }

    public void sendNow(OscMessage msg) throws IOException { client.send(msg); }

    private void run() {
        while (running.get() || !queue.isEmpty()) {
            try {
                OscMessage msg = queue.poll(100, TimeUnit.MILLISECONDS);
                if (msg != null) client.send(msg);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                errorHandler.accept(e);
            }
        }
    }

    @Override public void close() {
        running.set(false);
        worker.shutdownNow();
        client.close();
    }
}
