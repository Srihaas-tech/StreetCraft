package com.streetcraft;

import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.block.Block;

import java.util.Objects;
import java.util.Optional;

/** Performs a synchronous, read-only lookup of a block in an already-loaded chunk. */
public final class BlockReader {
    private final WorldAccess worldAccess;

    BlockReader(WorldAccess worldAccess) {
        this.worldAccess = Objects.requireNonNull(worldAccess, "worldAccess");
    }

    public static BlockReader fromServer(Server server) {
        return new BlockReader(new BukkitWorldAccess(server));
    }

    /** A live reader returned by {@link #fromServer(Server)} must run on the server thread. */
    public ReadResult read(String dimensionIdentifier, int x, int y, int z) {
        if (!Identifiers.isValid(dimensionIdentifier)) {
            return new InvalidDimension();
        }

        Optional<WorldView> maybeWorld = worldAccess.findWorld(dimensionIdentifier);
        if (!maybeWorld.isPresent()) {
            return new NotFound();
        }
        Optional<Block> maybeBlock = maybeWorld.get().getLoadedBlock(x, y, z);
        if (!maybeBlock.isPresent()) {
            return new NotFound();
        }

        Block block = maybeBlock.get();
        Material material = block.getType();
        return new Found(
                dimensionIdentifier,
                x,
                y,
                z,
                InventorySerializer.materialId(material),
                ContainerReader.isSupportedBlock(material)
        );
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(String dimensionIdentifier);
    }

    interface WorldView {
        Optional<Block> getLoadedBlock(int x, int y, int z);
    }

    public interface ReadResult {
    }

    public static final class Found implements ReadResult {
        private final String dimension;
        private final int x;
        private final int y;
        private final int z;
        private final String blockId;
        private final boolean supportedContainer;

        public Found(String dimension, int x, int y, int z, String blockId, boolean supportedContainer) {
            this.dimension = Objects.requireNonNull(dimension, "dimension");
            this.x = x;
            this.y = y;
            this.z = z;
            this.blockId = Objects.requireNonNull(blockId, "blockId");
            this.supportedContainer = supportedContainer;
        }

        public String dimension() {
            return dimension;
        }

        public int x() {
            return x;
        }

        public int y() {
            return y;
        }

        public int z() {
            return z;
        }

        public String blockId() {
            return blockId;
        }

        public boolean supportedContainer() {
            return supportedContainer;
        }
    }

    public static final class NotFound implements ReadResult {
    }

    public static final class InvalidDimension implements ReadResult {
    }

    private static final class BukkitWorldAccess implements WorldAccess {
        private final Server server;

        private BukkitWorldAccess(Server server) {
            this.server = Objects.requireNonNull(server, "server");
        }

        @Override
        public Optional<WorldView> findWorld(String dimensionIdentifier) {
            PaperWorlds.requireServerThread(server, "Block");
            String namespace = dimensionIdentifier.substring(0, dimensionIdentifier.indexOf(':'));
            String path = Identifiers.path(dimensionIdentifier);
            World world = PaperWorlds.find(server, namespace, path);
            return Optional.ofNullable(world).map(BukkitWorldView::new);
        }
    }

    private static final class BukkitWorldView implements WorldView {
        private final World world;

        private BukkitWorldView(World world) {
            this.world = Objects.requireNonNull(world, "world");
        }

        @Override
        public Optional<Block> getLoadedBlock(int x, int y, int z) {
            return Optional.ofNullable(PaperChunks.loadedChunk(world, x, z))
                    .map(chunk -> chunk.getBlock(x & 15, y, z & 15));
        }
    }
}