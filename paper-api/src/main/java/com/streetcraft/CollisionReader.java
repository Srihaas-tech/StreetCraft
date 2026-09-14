package com.streetcraft;

import org.bukkit.Chunk;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/** Reads sparse, actually collidable block positions for a rectangular region. */
public final class CollisionReader {
    private static final BlockFace[] DIRECTIONS = {
            BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST,
            BlockFace.UP, BlockFace.DOWN
    };

    private final WorldAccess worldAccess;

    CollisionReader(WorldAccess worldAccess) {
        this.worldAccess = Objects.requireNonNull(worldAccess, "worldAccess");
    }

    public static CollisionReader fromServer(Server server) {
        return new CollisionReader(new BukkitWorldAccess(server));
    }

    /** A live reader returned by {@link #fromServer(Server)} must run on the server thread. */
    public ReadResult read(String dimensionIdentifier, int fromX, int fromZ, int toX, int toZ) {
        if (!Identifiers.isValid(dimensionIdentifier)) {
            return new InvalidDimension();
        }

        Optional<WorldView> maybeWorld = worldAccess.findWorld(dimensionIdentifier);
        if (!maybeWorld.isPresent()) {
            return new NotFound();
        }

        WorldView world = maybeWorld.get();
        return new Found(dimensionIdentifier, fromX, fromZ,
                world.collisionBlocks(fromX, fromZ, toX, toZ));
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(String dimensionIdentifier);
    }

    interface WorldView {
        int[] collisionBlocks(int fromX, int fromZ, int toX, int toZ);
    }

    public interface ReadResult {
    }

    public static final class Found implements ReadResult {
        private final String dimension;
        private final int fromX;
        private final int fromZ;
        private final int[] blocks;

        public Found(String dimension, int fromX, int fromZ, int[] blocks) {
            this.dimension = Objects.requireNonNull(dimension, "dimension");
            this.fromX = fromX;
            this.fromZ = fromZ;
            this.blocks = Objects.requireNonNull(blocks, "blocks").clone();
        }

        public String dimension() {
            return dimension;
        }

        public int fromX() {
            return fromX;
        }

        public int fromZ() {
            return fromZ;
        }

        public int[] blocks() {
            return blocks.clone();
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
            PaperWorlds.requireServerThread(server, "Collision");
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
        public int[] collisionBlocks(int fromX, int fromZ, int toX, int toZ) {
            ArrayList<Integer> coordinates = new ArrayList<>();
            LoadedChunkData chunks = new LoadedChunkData(world);
            for (int x = fromX; x <= toX; x++) {
                for (int z = fromZ; z <= toZ; z++) {
                    for (int y = 0; y < world.getMaxHeight(); y++) {
                        int[] position = new int[]{x, y, z};
                        if (isCollidable(chunks, position) && isExposed(chunks, position)) {
                            coordinates.add(x);
                            coordinates.add(y);
                            coordinates.add(z);
                        }
                    }
                }
            }
            int[] result = new int[coordinates.size()];
            for (int index = 0; index < coordinates.size(); index++) {
                result[index] = coordinates.get(index);
            }
            return result;
        }

        private boolean isExposed(LoadedChunkData chunks, int[] position) {
            for (BlockFace direction : DIRECTIONS) {
                BlockData neighbor = chunks.dataAtUnchecked(position[0] + direction.getModX(),
                        position[1] + direction.getModY(), position[2] + direction.getModZ());
                if (neighbor == null || !isCollidableBlockData(neighbor)) {
                    return true;
                }
            }
            return false;
        }

        private static boolean isCollidable(LoadedChunkData chunks, int[] position) {
            BlockData data = chunks.dataAt(position[0], position[1], position[2]);
            return data != null && isCollidableBlockData(data);
        }

        private static boolean isCollidableBlockData(BlockData data) {
            Material material = data.getMaterial();
            return !isLeaves(material) && material.isOccluding();
        }

        private static boolean isLeaves(Material material) {
            return material == Material.LEGACY_LEAVES
                    || material == Material.LEGACY_LEAVES_2
                    || material.name().endsWith("_LEAVES");
        }
    }

    /** Reads block data without ever triggering chunk generation; unloaded areas read as absent. */
    private static final class LoadedChunkData {
        private final World world;
        private final Map<Long, Chunk> chunkCache = new HashMap<>();

        private LoadedChunkData(World world) {
            this.world = Objects.requireNonNull(world, "world");
        }

        BlockData dataAt(int x, int y, int z) {
            if (y < 0 || y >= world.getMaxHeight()) {
                return null;
            }
            return dataAtUnchecked(x, y, z);
        }

        BlockData dataAtUnchecked(int x, int y, int z) {
            long key = chunkKey(x, z);
            Chunk chunk = chunkCache.get(key);
            if (chunk == null) {
                chunk = PaperChunks.loadedChunk(world, x, z);
                if (chunk == null) {
                    return null;
                }
                chunkCache.put(key, chunk);
            }
            return chunk.getBlock(x & 15, y, z & 15).getBlockData();
        }
    }

    private static long chunkKey(int x, int z) {
        return ((long) z << 32) ^ ((long) x & 0xffffffffL);
    }
}