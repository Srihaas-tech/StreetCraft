package com.streetcraft;

import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

import java.util.ArrayList;
import java.util.Objects;
import java.util.Optional;

/** Reads sparse, actually collidable block positions for a rectangular region. */
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
        return new Found(dimensionIdentifier, fromX, fromZ,
                world.collisionBlocks(fromX, fromZ, toX, toZ));
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(Identifier dimension);
    }

    interface WorldView {
        int[] collisionBlocks(int fromX, int fromZ, int toX, int toZ);
    }

    public sealed interface ReadResult permits Found, NotFound, InvalidDimension {
    }

    public record Found(
            String dimension,
            int fromX,
            int fromZ,
            int[] blocks
    ) implements ReadResult {
        public Found {
            Objects.requireNonNull(dimension, "dimension");
            Objects.requireNonNull(blocks, "blocks");
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
        public int[] collisionBlocks(int fromX, int fromZ, int toX, int toZ) {
            ArrayList<Integer> coordinates = new ArrayList<>();
            BlockPos.Mutable position = new BlockPos.Mutable();
            for (int x = fromX; x <= toX; x++) {
                for (int z = fromZ; z <= toZ; z++) {
                    for (int y = world.getBottomY(); y < world.getTopY(); y++) {
                        position.set(x, y, z);
                        if (isCollidable(position) && isExposed(position)) {
                            coordinates.add(x);
                            coordinates.add(y);
                            coordinates.add(z);
                        }
                    }
                }
            }
            return coordinates.stream().mapToInt(Integer::intValue).toArray();
        }

        private boolean isExposed(BlockPos position) {
            for (var direction : net.minecraft.util.math.Direction.values()) {
                if (!isCollidable(position.offset(direction))) return true;
            }
            return false;
        }

        private boolean isCollidable(BlockPos position) {
            var state = world.getBlockState(position);
            return !state.isIn(BlockTags.LEAVES)
                    && !state.getCollisionShape(world, position).isEmpty();
        }
    }
}
