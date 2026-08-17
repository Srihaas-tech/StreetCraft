package com.streetcraft;

import net.minecraft.block.BlockState;
import net.minecraft.registry.Registries;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

import java.util.Objects;
import java.util.Optional;

/** Performs a synchronous, read-only lookup of a block in an already-loaded chunk. */
public final class BlockReader {
    private final WorldAccess worldAccess;

    BlockReader(WorldAccess worldAccess) {
        this.worldAccess = Objects.requireNonNull(worldAccess, "worldAccess");
    }

    public static BlockReader fromServer(MinecraftServer server) {
        return new BlockReader(new MinecraftWorldAccess(server));
    }

    /** A live reader returned by {@link #fromServer(MinecraftServer)} must run on the server thread. */
    public ReadResult read(String dimensionIdentifier, int x, int y, int z) {
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
        Optional<BlockState> maybeState = maybeWorld.get().getLoadedBlockState(new BlockPos(x, y, z));
        if (maybeState.isEmpty()) {
            return new NotFound();
        }

        BlockState state = maybeState.get();
        return new Found(
                dimension.toString(),
                x,
                y,
                z,
                Registries.BLOCK.getId(state.getBlock()).toString(),
                ContainerReader.isSupportedBlock(state.getBlock())
        );
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(Identifier dimension);
    }

    interface WorldView {
        Optional<BlockState> getLoadedBlockState(BlockPos position);
    }

    public sealed interface ReadResult permits Found, NotFound, InvalidDimension {
    }

    public record Found(
            String dimension,
            int x,
            int y,
            int z,
            String blockId,
            boolean supportedContainer
    ) implements ReadResult {
        public Found {
            Objects.requireNonNull(dimension, "dimension");
            Objects.requireNonNull(blockId, "blockId");
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
                throw new IllegalStateException("Block reads must run on the Minecraft server thread");
            }
            RegistryKey<World> worldKey = RegistryKey.of(RegistryKeys.WORLD, dimension);
            ServerWorld world = server.getWorld(worldKey);
            return Optional.ofNullable(world).map(MinecraftWorldView::new);
        }
    }

    private record MinecraftWorldView(ServerWorld world) implements WorldView {
        @Override
        public Optional<BlockState> getLoadedBlockState(BlockPos position) {
            int chunkX = Math.floorDiv(position.getX(), 16);
            int chunkZ = Math.floorDiv(position.getZ(), 16);
            return Optional.ofNullable(world.getChunkManager().getWorldChunk(chunkX, chunkZ))
                    .map(chunk -> chunk.getBlockState(position));
        }
    }
}
