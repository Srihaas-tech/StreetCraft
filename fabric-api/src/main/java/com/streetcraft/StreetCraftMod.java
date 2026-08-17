package com.streetcraft;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicReference;

public final class StreetCraftMod implements ModInitializer {
    public static final String MOD_ID = "streetcraft";
    private static final Logger LOGGER = LoggerFactory.getLogger(StreetCraftMod.class);
    private final AtomicReference<ContainerApi> api = new AtomicReference<>();

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            int port;
            try {
                port = ContainerApi.resolvePort(System.getenv("STREETCRAFT_FABRIC_API_PORT"));
            } catch (IllegalArgumentException invalidPort) {
                LOGGER.error("STREETCRAFT_FABRIC_API_PORT is invalid; Minecraft will continue without the local API");
                return;
            }

            ContainerApi localApi = ContainerApi.fromServer(server);
            if (localApi.start(port)) {
                ContainerApi previous = api.getAndSet(localApi);
                if (previous != null) {
                    previous.stop();
                }
            }
        });
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            ContainerApi localApi = api.getAndSet(null);
            if (localApi != null) {
                localApi.stop();
            }
        });
    }
}
