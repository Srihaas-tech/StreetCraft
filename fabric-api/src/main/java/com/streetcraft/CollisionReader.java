package com.streetcraft;

import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.world.Heightmap;
import net.minecraft.world.World;
import net.minecraft.world.chunk.WorldChunk;

import java.util.Objects;
import java.util.Optional;

/** Reads the MOTION_BLOCKING heightmap for a rectangular region of loaded chunks. */
public final class CollisionReader {
    private final WorldAccess worldAccess;

    CollisionReader(WorldAccess worldAccess) {
        this.worldAccess = Objects.requireNonNull(worldAccess, "worldAccess");
    }

    public static CollisionReader fromServer(MinecraftServer server) {
        return new CollisionReader(new MinecraftWorldAccess(server));
    }

    /** A live reader returned by {@link #fromServer(MinecraftServer)} must run on the server thread. */
    public ReadResult read(String dimensionIdentifier, int fromX, int fromZ, int toX, int toZ) {
        if (dimensionIdentifier == null) {
            return new InvalidDimension();
        }
        Identifier dimension = Identifier.tryParse(dimensionIdentifier);
        if (dimension == null) {
            return new InvalidDimension();
        }

        Optional<WorldView> maybeWorld = worldAccess.findWorld(dimension);
        if (maybeWorld.isEmpty()) {
            return new NotFound();
        }

        WorldView world = maybeWorld.get();
        int width = toX - fromX + 1;
        int depth = toZ - fromZ + 1;
        int[] heights = new int[width * depth];

        for (int dz = 0; dz < depth; dz++) {
            for (int dx = 0; dx < width; dx++) {
                heights[dz * width + dx] = world.sampleHeightmap(fromX + dx, fromZ + dz);
            }
        }

        return new Found(dimensionIdentifier, fromX, fromZ, width, depth, heights);
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(Identifier dimension);
    }

    interface WorldView {
        int sampleHeightmap(int x, int z);
    }

    public sealed interface ReadResult permits Found, NotFound, InvalidDimension {
    }

    public record Found(
            String dimension,
            int fromX,
            int fromZ,
            int width,
            int depth,
            int[] heights
    ) implements ReadResult {
        public Found {
            Objects.requireNonNull(dimension, "dimension");
            Objects.requireNonNull(heights, "heights");
        }
    }

    public record NotFound() implements ReadResult {
    }

    public record InvalidDimension() implements ReadResult {
    }

    private static final class MinecraftWorldAccess implements WorldAccess {
        private final MinecraftServer server;

        private MinecraftWorldAccess(MinecraftServer server) {
            this.server = Objects.requireNonNull(server, "server");
        }

        @Override
        public Optional<WorldView> findWorld(Identifier dimension) {
            if (!server.isOnThread()) {
                throw new IllegalStateException("Collision reads must run on the Minecraft server thread");
            }
            RegistryKey<World> worldKey = RegistryKey.of(RegistryKeys.WORLD, dimension);
            ServerWorld world = server.getWorld(worldKey);
            return Optional.ofNullable(world).map(MinecraftWorldView::new);
        }
    }

    private record MinecraftWorldView(ServerWorld world) implements WorldView {
        @Override
        public int sampleHeightmap(int x, int z) {
            int chunkX = Math.floorDiv(x, 16);
            int chunkZ = Math.floorDiv(z, 16);
            WorldChunk chunk = world.getChunkManager().getChunk(chunkX, chunkZ);
            if (chunk == null) return -1;
            return chunk.getHeightmap(Heightmap.Type.MOTION_BLOCKING).get(x & 15, z & 15);
        }
    }
}
