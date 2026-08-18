package com.streetcraft;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Loopback-only HTTP bridge to allowlisted, read-only Minecraft state. */
public final class ContainerApi {
    private static final Logger LOGGER = LoggerFactory.getLogger(ContainerApi.class);
    private static final String PORT_ENVIRONMENT_VARIABLE = "STREETCRAFT_FABRIC_API_PORT";
    private static final int DEFAULT_PORT = 8103;
    private static final int MAX_HORIZONTAL_COORDINATE = 30_000_000;
    private static final int MIN_Y = -2_048;
    private static final int MAX_Y = 2_047;
    private static final Duration DEFAULT_SERVER_THREAD_TIMEOUT = Duration.ofSeconds(1);
    static final int MAX_REQUEST_TARGET_BYTES = 4_096;

    private static final Map<String, String> JSON_HEADERS = Map.of(
            "Content-Type", "application/json; charset=utf-8",
            "Cache-Control", "no-store",
            "X-Content-Type-Options", "nosniff"
    );

    private final ContainerLookup containerLookup;
    private final BlockLookup blockLookup;
    private final ServerThreadScheduler scheduler;
    private final ListenerFactory listenerFactory;
    private final Duration serverThreadTimeout;
    private Listener listener;

    ContainerApi(
            ContainerLookup containerLookup,
            BlockLookup blockLookup,
            ServerThreadScheduler scheduler,
            ListenerFactory listenerFactory,
            Duration serverThreadTimeout
    ) {
        this.containerLookup = Objects.requireNonNull(containerLookup, "containerLookup");
        this.blockLookup = Objects.requireNonNull(blockLookup, "blockLookup");
        this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
        this.listenerFactory = Objects.requireNonNull(listenerFactory, "listenerFactory");
        this.serverThreadTimeout = Objects.requireNonNull(serverThreadTimeout, "serverThreadTimeout");
        if (serverThreadTimeout.isZero() || serverThreadTimeout.isNegative()) {
            throw new IllegalArgumentException("serverThreadTimeout must be positive");
        }
    }

    public static ContainerApi fromServer(MinecraftServer server) {
        Objects.requireNonNull(server, "server");
        ContainerReader containerReader = ContainerReader.fromServer(server);
        BlockReader blockReader = BlockReader.fromServer(server);
        return new ContainerApi(
                containerReader::read,
                blockReader::read,
                server::execute,
                new JdkListenerFactory(),
                DEFAULT_SERVER_THREAD_TIMEOUT
        );
    }

    static int resolvePort(String configuredPort) {
        if (configuredPort == null) {
            return DEFAULT_PORT;
        }
        if (!configuredPort.matches("[0-9]{1,5}")) {
            throw new IllegalArgumentException(PORT_ENVIRONMENT_VARIABLE + " must be a decimal port");
        }
        int port = Integer.parseInt(configuredPort);
        if (port < 1 || port > 65_535) {
            throw new IllegalArgumentException(PORT_ENVIRONMENT_VARIABLE + " must be between 1 and 65535");
        }
        return port;
    }

    public synchronized boolean start(int port) {
        if (listener != null) {
            return true;
        }
        if (port < 1 || port > 65_535) {
            throw new IllegalArgumentException("port must be between 1 and 65535");
        }
        try {
            InetSocketAddress address = new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port);
            listener = Objects.requireNonNull(listenerFactory.start(address, this::serve), "listener");
            LOGGER.info("StreetCraft Fabric API listening on 127.0.0.1:{}", port);
            return true;
        } catch (IOException | RuntimeException exception) {
            listener = null;
            LOGGER.error("StreetCraft Fabric API could not start; Minecraft will continue without the local API");
            return false;
        }
    }

    public synchronized void stop() {
        if (listener != null) {
            listener.stop();
            listener = null;
        }
    }

    Response handle(String method, URI uri) {
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(uri, "uri");
        if (!"GET".equals(method)) {
            return error(405, "method_not_allowed", Map.of("Allow", "GET"));
        }
        if (uri.toASCIIString().getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_TARGET_BYTES) {
            return error(400, "invalid_request");
        }

        String path = uri.getRawPath();
        if (!"/container".equals(path) && !"/block".equals(path)) {
            return error(404, "not_found");
        }

        PositionQuery query;
        try {
            query = parseQuery(uri.getRawQuery());
        } catch (IllegalArgumentException exception) {
            return error(400, "invalid_request");
        }

        if ("/container".equals(path)) {
            return dispatch(() -> mapContainerResult(containerLookup.read(
                    query.dimension(), query.x(), query.y(), query.z()
            )));
        }
        return dispatch(() -> mapBlockResult(blockLookup.read(
                query.dimension(), query.x(), query.y(), query.z()
        )));
    }

    private Response dispatch(ResponseSupplier supplier) {
        CompletableFuture<Response> response = new CompletableFuture<>();
        DispatchClaim claim = new DispatchClaim();
        try {
            scheduler.execute(() -> {
                if (!claim.tryClaimRunning()) {
                    return;
                }
                try {
                    response.complete(supplier.get());
                } catch (Throwable failure) {
                    response.completeExceptionally(failure);
                }
            });
        } catch (RuntimeException unavailable) {
            claim.cancelQueued();
            return error(503, "service_unavailable");
        }

        try {
            return response.get(serverThreadTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException timeout) {
            claim.cancelQueued();
            response.cancel(false);
            return error(503, "service_unavailable");
        } catch (InterruptedException interrupted) {
            claim.cancelQueued();
            response.cancel(false);
            Thread.currentThread().interrupt();
            return error(503, "service_unavailable");
        } catch (ExecutionException failure) {
            return error(500, "internal_error");
        }
    }

    private static Response mapContainerResult(ContainerReader.ReadResult result) {
        if (result instanceof ContainerReader.Found found) {
            return json(200, inventoryJson(found.inventory()));
        }
        if (result instanceof ContainerReader.InvalidDimension) {
            return error(400, "invalid_request");
        }
        if (result instanceof ContainerReader.NotFound || result instanceof ContainerReader.Unsupported) {
            return error(404, "container_not_found");
        }
        return error(500, "internal_error");
    }

    private static Response mapBlockResult(BlockReader.ReadResult result) {
        if (result instanceof BlockReader.Found found) {
            String body = "{\"dimension\":" + quote(found.dimension())
                    + ",\"x\":" + found.x()
                    + ",\"y\":" + found.y()
                    + ",\"z\":" + found.z()
                    + ",\"blockId\":" + quote(found.blockId())
                    + ",\"supportedContainer\":" + found.supportedContainer()
                    + "}";
            return json(200, body);
        }
        if (result instanceof BlockReader.InvalidDimension) {
            return error(400, "invalid_request");
        }
        if (result instanceof BlockReader.NotFound) {
            return error(404, "block_not_found");
        }
        return error(500, "internal_error");
    }

    private static PositionQuery parseQuery(String rawQuery) {
        if (rawQuery == null || rawQuery.isEmpty()) {
            throw new IllegalArgumentException("query required");
        }
        Map<String, String> values = new HashMap<>();
        for (String pair : rawQuery.split("&", -1)) {
            int separator = pair.indexOf('=');
            if (separator < 1 || separator != pair.lastIndexOf('=')) {
                throw new IllegalArgumentException("malformed parameter");
            }
            String key = strictDecode(pair.substring(0, separator));
            String value = strictDecode(pair.substring(separator + 1));
            if (!List.of("dimension", "x", "y", "z").contains(key)
                    || value.isEmpty()
                    || values.putIfAbsent(key, value) != null) {
                throw new IllegalArgumentException("invalid parameter");
            }
        }
        if (values.size() != 4) {
            throw new IllegalArgumentException("missing parameter");
        }

        String dimension = values.get("dimension");
        if (Identifier.tryParse(dimension) == null) {
            throw new IllegalArgumentException("invalid dimension");
        }
        int x = parseCoordinate(values.get("x"), -MAX_HORIZONTAL_COORDINATE, MAX_HORIZONTAL_COORDINATE);
        int y = parseCoordinate(values.get("y"), MIN_Y, MAX_Y);
        int z = parseCoordinate(values.get("z"), -MAX_HORIZONTAL_COORDINATE, MAX_HORIZONTAL_COORDINATE);
        return new PositionQuery(dimension, x, y, z);
    }

    private static int parseCoordinate(String value, int minimum, int maximum) {
        if (!value.matches("-?(0|[1-9][0-9]{0,9})")) {
            throw new IllegalArgumentException("invalid coordinate");
        }
        try {
            int coordinate = Integer.parseInt(value);
            if (coordinate < minimum || coordinate > maximum) {
                throw new IllegalArgumentException("coordinate out of range");
            }
            return coordinate;
        } catch (NumberFormatException outOfRange) {
            throw new IllegalArgumentException("coordinate out of range");
        }
    }

    private static String strictDecode(String encoded) {
        byte[] bytes = new byte[encoded.length()];
        int size = 0;
        for (int index = 0; index < encoded.length(); index++) {
            char character = encoded.charAt(index);
            if (character == '%') {
                if (index + 2 >= encoded.length()) {
                    throw new IllegalArgumentException("malformed percent encoding");
                }
                int high = Character.digit(encoded.charAt(++index), 16);
                int low = Character.digit(encoded.charAt(++index), 16);
                if (high < 0 || low < 0) {
                    throw new IllegalArgumentException("malformed percent encoding");
                }
                bytes[size++] = (byte) ((high << 4) | low);
            } else if (character == '+') {
                bytes[size++] = (byte) ' ';
            } else if (character <= 0x7f) {
                bytes[size++] = (byte) character;
            } else {
                throw new IllegalArgumentException("query must be percent encoded");
            }
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes, 0, size))
                    .toString();
        } catch (CharacterCodingException malformedUtf8) {
            throw new IllegalArgumentException("malformed utf-8");
        }
    }

    private static String inventoryJson(InventorySerializer.SerializedInventory inventory) {
        StringBuilder json = new StringBuilder();
        json.append("{\"containerType\":").append(quote(inventory.containerType()))
                .append(",\"size\":").append(inventory.size())
                .append(",\"items\":[");
        for (int index = 0; index < inventory.items().size(); index++) {
            if (index > 0) {
                json.append(',');
            }
            InventorySerializer.SerializedItemStack item = inventory.items().get(index);
            json.append("{\"slot\":").append(item.slot())
                    .append(",\"itemId\":").append(quote(item.itemId()))
                    .append(",\"count\":").append(item.count())
                    .append(",\"displayName\":").append(quote(item.displayName()))
                    .append(",\"safeTooltipData\":{\"damage\":").append(item.safeTooltipData().damage())
                    .append(",\"maxDamage\":").append(item.safeTooltipData().maxDamage())
                    .append(",\"glint\":").append(item.safeTooltipData().glint())
                    .append("}}");
        }
        return json.append("]}").toString();
    }

    private static String quote(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
                }
            }
        }
        return escaped.append('"').toString();
    }

    private static Response json(int status, String body) {
        return new Response(status, body, JSON_HEADERS);
    }

    private static Response error(int status, String code) {
        return error(status, code, Map.of());
    }

    private static Response error(int status, String code, Map<String, String> extraHeaders) {
        Map<String, String> headers = new LinkedHashMap<>(JSON_HEADERS);
        headers.putAll(extraHeaders);
        return new Response(status, "{\"error\":" + quote(code) + "}", headers);
    }

    private void serve(HttpExchange exchange) throws IOException {
        Response response = handle(exchange.getRequestMethod(), exchange.getRequestURI());
        for (Map.Entry<String, String> header : response.headers().entrySet()) {
            exchange.getResponseHeaders().set(header.getKey(), header.getValue());
        }
        byte[] body = response.body().getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(response.status(), body.length);
        try (var output = exchange.getResponseBody()) {
            output.write(body);
        } finally {
            exchange.close();
        }
    }

    record PositionQuery(String dimension, int x, int y, int z) {
    }

    record Response(int status, String body, Map<String, String> headers) {
        Response {
            Objects.requireNonNull(body, "body");
            headers = Map.copyOf(headers);
        }
    }

    @FunctionalInterface
    interface ContainerLookup {
        ContainerReader.ReadResult read(String dimension, int x, int y, int z);
    }

    @FunctionalInterface
    interface BlockLookup {
        BlockReader.ReadResult read(String dimension, int x, int y, int z);
    }

    @FunctionalInterface
    interface ServerThreadScheduler {
        void execute(Runnable command);
    }

    @FunctionalInterface
    interface ListenerFactory {
        Listener start(InetSocketAddress address, HttpHandler handler) throws IOException;
    }

    @FunctionalInterface
    interface Listener {
        void stop();
    }

    @FunctionalInterface
    private interface ResponseSupplier {
        Response get();
    }

    static final class DispatchClaim {
        private final AtomicReference<State> state = new AtomicReference<>(State.QUEUED);

        boolean tryClaimRunning() {
            return state.compareAndSet(State.QUEUED, State.RUNNING);
        }

        boolean cancelQueued() {
            return state.compareAndSet(State.QUEUED, State.CANCELLED);
        }

        private enum State {
            QUEUED,
            RUNNING,
            CANCELLED
        }
    }

    private static final class JdkListenerFactory implements ListenerFactory {
        private static final int WORKER_COUNT = 2;
        private static final int MAX_QUEUED_REQUESTS = 64;
        private static final AtomicInteger THREAD_SEQUENCE = new AtomicInteger();

        @Override
        public Listener start(InetSocketAddress address, HttpHandler handler) throws IOException {
            HttpServer server = HttpServer.create(address, 0);
            ThreadPoolExecutor executor = new ThreadPoolExecutor(
                    WORKER_COUNT,
                    WORKER_COUNT,
                    0L,
                    TimeUnit.MILLISECONDS,
                    new ArrayBlockingQueue<>(MAX_QUEUED_REQUESTS),
                    runnable -> {
                        Thread thread = new Thread(
                                runnable,
                                "streetcraft-fabric-api-" + THREAD_SEQUENCE.incrementAndGet()
                        );
                        thread.setDaemon(true);
                        return thread;
                    },
                    new ThreadPoolExecutor.AbortPolicy()
            );
            try {
                server.createContext("/", handler);
                server.setExecutor(executor);
                server.start();
            } catch (RuntimeException failure) {
                server.stop(0);
                executor.shutdownNow();
                throw failure;
            }
            return () -> {
                server.stop(0);
                executor.shutdownNow();
            };
        }
    }
}
