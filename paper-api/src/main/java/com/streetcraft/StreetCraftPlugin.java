package com.streetcraft;

import org.bukkit.plugin.java.JavaPlugin;

/** Paper plugin entry point; hosts the loopback StreetCraft API within a Bukkit server. */
public final class StreetCraftPlugin extends JavaPlugin {
    private ContainerApi api;

    @Override
    public void onEnable() {
        int port;
        try {
            port = ContainerApi.resolvePort(System.getenv("STREETCRAFT_FABRIC_API_PORT"));
        } catch (IllegalArgumentException invalidPort) {
            getLogger().warning("STREETCRAFT_FABRIC_API_PORT is invalid; Minecraft will continue without the local API");
            return;
        }

        ContainerApi localApi = ContainerApi.fromServers(getServer(), this);
        if (localApi.start(port)) {
            api = localApi;
        }
    }

    @Override
    public void onDisable() {
        ContainerApi localApi = api;
        api = null;
        if (localApi != null) {
            localApi.stop();
        }
    }
}