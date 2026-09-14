package com.streetcraft;

import org.bukkit.Chunk;
import org.bukkit.World;

import java.util.Objects;

/** Loaded-chunk access that never generates terrain; unloaded chunks read as absent. */
final class PaperChunks {
    private PaperChunks() {
    }

    static Chunk loadedChunk(World world, int x, int z) {
        Objects.requireNonNull(world, "world");
        int chunkX = Math.floorDiv(x, 16);
        int chunkZ = Math.floorDiv(z, 16);
        return world.isChunkLoaded(chunkX, chunkZ) ? world.getChunkAt(chunkX, chunkZ) : null;
    }
}