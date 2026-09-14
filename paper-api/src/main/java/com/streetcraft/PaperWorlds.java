package com.streetcraft;

import org.bukkit.Server;
import org.bukkit.World;

import java.util.Objects;

/** Maps Minecraft dimension identifiers to the world folders Bukkit knows about. */
final class PaperWorlds {
    private static final String OVERWORLD = "overworld";
    private static final String THE_NETHER = "the_nether";
    private static final String THE_END = "the_end";

    private PaperWorlds() {
    }

    /**
     * Resolves a dimension identifier to a live world. Bukkit keys worlds by folder name and
     * environment rather than by registry key, so resolution prefers an exact name match and then
     * falls back to the vanilla environment mapping.
     */
    static World find(Server server, String namespace, String path) {
        Objects.requireNonNull(server, "server");
        World byName = server.getWorld(path);
        if (byName != null) {
            return byName;
        }
        World.Environment environment = environmentFor(path);
        if (environment != null) {
            for (World world : server.getWorlds()) {
                if (world.getEnvironment() == environment) {
                    return world;
                }
            }
        }
        World byFullName = server.getWorld(namespace + ':' + path);
        return byFullName;
    }

    /**
     * Asserts the caller is the server's primary (Minecraft) thread; Minecraft state reads must
     * never touch chunks from a request thread.
     */
    static void requireServerThread(Server server, String what) {
        if (!server.isPrimaryThread()) {
            throw new IllegalStateException(what + " reads must run on the Minecraft server thread");
        }
    }

    private static World.Environment environmentFor(String path) {
        switch (path) {
            case OVERWORLD:
                return World.Environment.NORMAL;
            case THE_NETHER:
                return World.Environment.NETHER;
            case THE_END:
                return World.Environment.THE_END;
            default:
                return null;
        }
    }
}