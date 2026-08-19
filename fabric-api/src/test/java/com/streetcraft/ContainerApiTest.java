package com.streetcraft;

import com.sun.net.httpserver.HttpHandler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ContainerApiTest {
    private final AtomicInteger containerReads = new AtomicInteger();
    private final AtomicInteger blockReads = new AtomicInteger();
    private final RecordingListenerFactory listenerFactory = new RecordingListenerFactory();
    private ExecutorService minecraftExecutor;

    @BeforeAll
    static void bootstrapMinecraftRegistries() {
        MinecraftTestBootstrap.initialize();
    }

    @AfterEach
    void stopExecutor() {
        if (minecraftExecutor != null) {
            minecraftExecutor.shutdownNow();
        }
    }

    @Test
    void returnsOnlyTaskSevenSafeScalarsForAFoundContainer() {
        InventorySerializer.SerializedInventory inventory = new InventorySerializer.SerializedInventory(
                "chest",
                27,
                List.of(new InventorySerializer.SerializedItemStack(
                        4,
                        "minecraft:diamond",
                        12,
                        "Polished \"Diamond\"",
                        new InventorySerializer.SafeTooltipData(0, 0, true)
                ))
        );
        ContainerApi api = api(
                (dimension, x, y, z) -> new ContainerReader.Found(inventory),
                immediateScheduler()
        );

        ContainerApi.Response response = api.handle(
                "GET",
                URI.create("/container?dimension=minecraft%3Aoverworld&x=1&y=64&z=-2")
        );

        assertEquals(200, response.status());
        assertEquals(
                "{\"containerType\":\"chest\",\"size\":27,\"items\":[{\"slot\":4,\"itemId\":\"minecraft:diamond\",\"count\":12,\"displayName\":\"Polished \\\"Diamond\\\"\",\"safeTooltipData\":{\"damage\":0,\"maxDamage\":0,\"glint\":true}}]}",
                response.body()
        );
        assertEquals("application/json; charset=utf-8", response.headers().get("Content-Type"));
        assertEquals("no-store", response.headers().get("Cache-Control"));
        assertEquals("nosniff", response.headers().get("X-Content-Type-Options"));
        assertFalse(response.body().contains("nbt"));
        assertFalse(response.body().contains("component"));
    }

    @Test
    void mapsMissingAndUnsupportedContainersToTheSameStableNotFoundResponse() {
        ContainerApi missing = api((dimension, x, y, z) -> new ContainerReader.NotFound(), immediateScheduler());
        ContainerApi unsupported = api(
                (dimension, x, y, z) -> new ContainerReader.Unsupported("private:do_not_reflect"),
                immediateScheduler()
        );
        URI request = URI.create("/container?dimension=minecraft:overworld&x=1&y=64&z=2");

        assertResponse(missing.handle("GET", request), 404, "{\"error\":\"container_not_found\"}");
        ContainerApi.Response response = unsupported.handle("GET", request);
        assertResponse(response, 404, "{\"error\":\"container_not_found\"}");
        assertFalse(response.body().contains("private"));
    }

    @Test
    void rejectsMissingDuplicateMalformedAndOutOfRangePositionValues() {
        ContainerApi api = api((dimension, x, y, z) -> {
            containerReads.incrementAndGet();
            return new ContainerReader.NotFound();
        }, immediateScheduler());

        List<String> invalidTargets = List.of(
                "/container?dimension=minecraft:overworld&x=1&y=64",
                "/container?dimension=minecraft:overworld&x=1&x=2&y=64&z=3",
                "/container?dimension=Minecraft:Overworld&x=1&y=64&z=3",
                "/container?dimension=minecraft:overworld&x=one&y=64&z=3",
                "/container?dimension=minecraft:overworld&x=30000001&y=64&z=3",
                "/container?dimension=minecraft:overworld&x=1&y=2048&z=3",
                "/container?dimension=minecraft:overworld&x=1&y=64&z=3&extra=true",
                "/container?dimension=minecraft%ZZoverworld&x=1&y=64&z=3"
        );

        for (String target : invalidTargets) {
            assertResponse(api.handle("GET", URI.create(target.replace("%ZZ", "%25ZZ"))), 400,
                    "{\"error\":\"invalid_request\"}");
        }
        assertEquals(0, containerReads.get());
    }

    @Test
    void rejectsNonGetMethodsAndOversizedRequestTargetsBeforeReadingMinecraft() {
        ContainerApi api = api((dimension, x, y, z) -> {
            containerReads.incrementAndGet();
            return new ContainerReader.NotFound();
        }, immediateScheduler());
        URI valid = URI.create("/container?dimension=minecraft:overworld&x=1&y=64&z=3");

        ContainerApi.Response methodResponse = api.handle("POST", valid);
        assertResponse(methodResponse, 405, "{\"error\":\"method_not_allowed\"}");
        assertEquals("GET", methodResponse.headers().get("Allow"));

        String oversized = "a".repeat(ContainerApi.MAX_REQUEST_TARGET_BYTES + 1);
        assertResponse(api.handle("GET", URI.create("/container?" + oversized)), 400,
                "{\"error\":\"invalid_request\"}");
        assertEquals(0, containerReads.get());
    }

    @Test
    void bindsOnlyToIpv4LoopbackAndStopsTheListener() {
        ContainerApi api = api((dimension, x, y, z) -> new ContainerReader.NotFound(), immediateScheduler());

        assertTrue(api.start(9123));
        assertEquals("127.0.0.1", listenerFactory.address.getAddress().getHostAddress());
        assertEquals(9123, listenerFactory.address.getPort());

        api.stop();
        assertEquals(1, listenerFactory.listener.stops.get());
    }

    @Test
    void usesDefaultPortAndStrictlyValidatesOperatorOverrides() {
        assertEquals(8103, ContainerApi.resolvePort(null));
        assertEquals(9123, ContainerApi.resolvePort("9123"));

        for (String invalid : List.of("", " 8103", "+8103", "0", "65536", "1.5", "abc")) {
            assertThrows(IllegalArgumentException.class, () -> ContainerApi.resolvePort(invalid));
        }
    }

    @Test
    void aBindFailureIsNonFatalAndLeavesNoRunningListener() {
        listenerFactory.failure = new IOException("sensitive bind details");
        ContainerApi api = api((dimension, x, y, z) -> new ContainerReader.NotFound(), immediateScheduler());

        assertFalse(api.start(8103));
        api.stop();

        assertEquals(0, listenerFactory.listener.stops.get());
    }

    @Test
    void schedulesMinecraftReadsAwayFromTheRequestThread() {
        AtomicReference<String> readThread = new AtomicReference<>();
        minecraftExecutor = Executors.newSingleThreadExecutor(runnable -> new Thread(runnable, "minecraft-test-thread"));
        ContainerApi api = api((dimension, x, y, z) -> {
            readThread.set(Thread.currentThread().getName());
            return new ContainerReader.NotFound();
        }, command -> minecraftExecutor.execute(command));

        ContainerApi.Response response = api.handle(
                "GET",
                URI.create("/container?dimension=minecraft:overworld&x=1&y=64&z=3")
        );

        assertEquals(404, response.status());
        assertEquals("minecraft-test-thread", readThread.get());
        assertFalse(Thread.currentThread().getName().equals(readThread.get()));
    }

    @Test
    void mapsTimeoutAndUnavailableSchedulingToANonLeakingServiceUnavailable() {
        AtomicReference<Runnable> delayedRead = new AtomicReference<>();
        ContainerApi timeoutApi = new ContainerApi(
                (dimension, x, y, z) -> {
                    containerReads.incrementAndGet();
                    return new ContainerReader.NotFound();
                },
                (dimension, x, y, z) -> new BlockReader.NotFound(),
                (dimension, fromX, fromZ, toX, toZ) -> new CollisionReader.NotFound(),
                delayedRead::set,
                listenerFactory,
                Duration.ofMillis(5)
        );
        ContainerApi unavailableApi = api(
                (dimension, x, y, z) -> new ContainerReader.NotFound(),
                command -> { throw new RejectedExecutionException("sensitive server state"); }
        );
        URI request = URI.create("/container?dimension=minecraft:overworld&x=1&y=64&z=3");

        assertResponse(timeoutApi.handle("GET", request), 503, "{\"error\":\"service_unavailable\"}");
        delayedRead.get().run();
        assertResponse(unavailableApi.handle("GET", request), 503, "{\"error\":\"service_unavailable\"}");
        assertEquals(0, containerReads.get());
    }

    @Test
    void cancellationBetweenWorkerWakeupAndReadClaimAtomicallyPreventsTheRead() throws Exception {
        ContainerApi.DispatchClaim claim = new ContainerApi.DispatchClaim();
        CountDownLatch workerAwake = new CountDownLatch(1);
        CountDownLatch allowClaim = new CountDownLatch(1);
        AtomicInteger reads = new AtomicInteger();
        Thread worker = new Thread(() -> {
            workerAwake.countDown();
            try {
                allowClaim.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return;
            }
            if (claim.tryClaimRunning()) {
                reads.incrementAndGet();
            }
        }, "minecraft-claim-test");

        worker.start();
        assertTrue(workerAwake.await(1, TimeUnit.SECONDS));
        assertTrue(claim.cancelQueued());
        allowClaim.countDown();
        worker.join(1_000);

        assertFalse(worker.isAlive());
        assertEquals(0, reads.get());
        assertFalse(claim.tryClaimRunning());
    }

    @Test
    void interruptedWaitCancelsQueuedWorkBeforeExecutorShutdownCanRunIt() throws Exception {
        AtomicReference<Runnable> delayedRead = new AtomicReference<>();
        CountDownLatch scheduled = new CountDownLatch(1);
        AtomicReference<ContainerApi.Response> result = new AtomicReference<>();
        AtomicBoolean interruptRestored = new AtomicBoolean();
        ContainerApi api = new ContainerApi(
                (dimension, x, y, z) -> {
                    containerReads.incrementAndGet();
                    return new ContainerReader.NotFound();
                },
                (dimension, x, y, z) -> new BlockReader.NotFound(),
                (dimension, fromX, fromZ, toX, toZ) -> new CollisionReader.NotFound(),
                command -> {
                    delayedRead.set(command);
                    scheduled.countDown();
                },
                listenerFactory,
                Duration.ofSeconds(5)
        );
        Thread requestWorker = new Thread(() -> {
            result.set(api.handle(
                    "GET",
                    URI.create("/container?dimension=minecraft:overworld&x=1&y=64&z=3")
            ));
            interruptRestored.set(Thread.currentThread().isInterrupted());
        }, "http-worker-shutdown-test");

        requestWorker.start();
        assertTrue(scheduled.await(1, TimeUnit.SECONDS));
        requestWorker.interrupt();
        requestWorker.join(1_000);

        assertFalse(requestWorker.isAlive());
        assertResponse(result.get(), 503, "{\"error\":\"service_unavailable\"}");
        assertTrue(interruptRestored.get());
        delayedRead.get().run();
        assertEquals(0, containerReads.get());
    }

    @Test
    void returnsPublicBlockInfoWithoutAnyInventoryOrItemData() {
        ContainerApi api = new ContainerApi(
                (dimension, x, y, z) -> new ContainerReader.NotFound(),
                (dimension, x, y, z) -> {
                    blockReads.incrementAndGet();
                    return new BlockReader.Found(dimension, x, y, z, "minecraft:barrel", true);
                },
                (dimension, fromX, fromZ, toX, toZ) -> new CollisionReader.NotFound(),
                immediateScheduler(),
                listenerFactory,
                Duration.ofSeconds(1)
        );

        ContainerApi.Response response = api.handle(
                "GET",
                URI.create("/block?dimension=minecraft:overworld&x=7&y=80&z=-9")
        );

        assertResponse(response, 200,
                "{\"dimension\":\"minecraft:overworld\",\"x\":7,\"y\":80,\"z\":-9,\"blockId\":\"minecraft:barrel\",\"supportedContainer\":true}");
        assertEquals(1, blockReads.get());
        String lowerCaseBody = response.body().toLowerCase();
        assertFalse(lowerCaseBody.contains("inventory"));
        assertFalse(lowerCaseBody.contains("item"));
        assertFalse(lowerCaseBody.contains("slot"));
    }

    @Test
    void mapsUnavailableBlockPositionsAndUnexpectedFailuresWithoutDetails() {
        ContainerApi missing = new ContainerApi(
                (dimension, x, y, z) -> new ContainerReader.NotFound(),
                (dimension, x, y, z) -> new BlockReader.NotFound(),
                (dimension, fromX, fromZ, toX, toZ) -> new CollisionReader.NotFound(),
                immediateScheduler(), listenerFactory, Duration.ofSeconds(1)
        );
        ContainerApi corrupt = api(
                (dimension, x, y, z) -> { throw new IllegalStateException("secret upstream detail"); },
                immediateScheduler()
        );
        URI block = URI.create("/block?dimension=minecraft:overworld&x=1&y=64&z=3");
        URI container = URI.create("/container?dimension=minecraft:overworld&x=1&y=64&z=3");

        assertResponse(missing.handle("GET", block), 404, "{\"error\":\"block_not_found\"}");
        ContainerApi.Response response = corrupt.handle("GET", container);
        assertResponse(response, 500, "{\"error\":\"internal_error\"}");
        assertFalse(response.body().contains("secret"));
    }

    @Test
    void returnsCollisionHeightsForAValidRegion() {
        ContainerApi api = new ContainerApi(
                (dimension, x, y, z) -> new ContainerReader.NotFound(),
                (dimension, x, y, z) -> new BlockReader.NotFound(),
                (dimension, fromX, fromZ, toX, toZ) -> new CollisionReader.Found(
                        dimension, fromX, fromZ, 2, 1, new int[]{64, 65}
                ),
                immediateScheduler(), listenerFactory, Duration.ofSeconds(1)
        );

        ContainerApi.Response response = api.handle(
                "GET",
                URI.create("/collision?dimension=minecraft:overworld&fromX=10&fromZ=20&toX=11&toZ=20")
        );

        assertResponse(response, 200,
                "{\"dimension\":\"minecraft:overworld\",\"fromX\":10,\"fromZ\":20,\"width\":2,\"depth\":1,\"heights\":[64,65]}");
    }

    @Test
    void rejectsCollisionQueryWithInvalidRange() {
        ContainerApi api = api((dimension, x, y, z) -> new ContainerReader.NotFound(), immediateScheduler());

        assertResponse(api.handle("GET",
                URI.create("/collision?dimension=minecraft:overworld&fromX=11&fromZ=20&toX=10&toZ=20")),
                400, "{\"error\":\"invalid_request\"}");
    }

    @Test
    void rejectsCollisionQueryWithTooLargeRegion() {
        ContainerApi api = api((dimension, x, y, z) -> new ContainerReader.NotFound(), immediateScheduler());

        assertResponse(api.handle("GET",
                URI.create("/collision?dimension=minecraft:overworld&fromX=0&fromZ=0&toX=32&toZ=32")),
                400, "{\"error\":\"invalid_request\"}");
    }

    @Test
    void rejectsCollisionQueryWithMissingParameters() {
        ContainerApi api = api((dimension, x, y, z) -> new ContainerReader.NotFound(), immediateScheduler());

        assertResponse(api.handle("GET",
                URI.create("/collision?dimension=minecraft:overworld&fromX=0&fromZ=0&toX=5")),
                400, "{\"error\":\"invalid_request\"}");
    }

    private ContainerApi api(ContainerApi.ContainerLookup lookup, ContainerApi.ServerThreadScheduler scheduler) {
        return new ContainerApi(
                lookup,
                (dimension, x, y, z) -> new BlockReader.NotFound(),
                (dimension, fromX, fromZ, toX, toZ) -> new CollisionReader.NotFound(),
                scheduler,
                listenerFactory,
                Duration.ofSeconds(1)
        );
    }

    private static ContainerApi.ServerThreadScheduler immediateScheduler() {
        return Runnable::run;
    }

    private static void assertResponse(ContainerApi.Response response, int status, String body) {
        assertEquals(status, response.status());
        assertEquals(body, response.body());
        assertEquals("application/json; charset=utf-8", response.headers().get("Content-Type"));
        assertEquals("no-store", response.headers().get("Cache-Control"));
        assertEquals("nosniff", response.headers().get("X-Content-Type-Options"));
    }

    private static final class RecordingListenerFactory implements ContainerApi.ListenerFactory {
        private final RecordingListener listener = new RecordingListener();
        private InetSocketAddress address;
        private IOException failure;

        @Override
        public ContainerApi.Listener start(InetSocketAddress requestedAddress, HttpHandler handler) throws IOException {
            address = requestedAddress;
            if (failure != null) {
                throw failure;
            }
            return listener;
        }
    }

    private static final class RecordingListener implements ContainerApi.Listener {
        private final AtomicInteger stops = new AtomicInteger();

        @Override
        public void stop() {
            stops.incrementAndGet();
        }
    }
}
