package com.streetcraft;

import net.minecraft.block.Blocks;
import net.minecraft.util.Identifier;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

class CollisionReaderTest {
    @BeforeAll
    static void bootstrapMinecraftRegistries() {
        MinecraftTestBootstrap.initialize();
    }

    @Test
    void returnsHeightmapValuesForAValidRegion() {
        FakeCollisionWorld world = new FakeCollisionWorld();
        world.setHeight(10, 20, 64);
        world.setHeight(11, 20, 65);
        world.setHeight(10, 21, 63);
        world.setHeight(11, 21, 66);

        CollisionReader.Found found = assertInstanceOf(
                CollisionReader.Found.class,
                new CollisionReader(world).read("minecraft:overworld", 10, 20, 11, 21)
        );

        assertEquals("minecraft:overworld", found.dimension());
        assertEquals(10, found.fromX());
        assertEquals(20, found.fromZ());
        assertEquals(2, found.width());
        assertEquals(2, found.depth());
        assertArrayEquals(new int[]{64, 65, 63, 66}, found.heights());
        assertEquals(4, world.heightmapReads.get());
    }

    @Test
    void returnsNotFoundWhenDimensionIsUnavailable() {
        FakeCollisionWorld world = new FakeCollisionWorld();
        world.worldAvailable = false;

        assertInstanceOf(CollisionReader.NotFound.class,
                new CollisionReader(world).read("minecraft:the_nether", 0, 0, 0, 0));
        assertEquals(0, world.heightmapReads.get());
    }

    @Test
    void rejectsMalformedDimensionsBeforeWorldAccess() {
        FakeCollisionWorld world = new FakeCollisionWorld();

        assertInstanceOf(CollisionReader.InvalidDimension.class,
                new CollisionReader(world).read("Minecraft:Overworld", 0, 0, 0, 0));
        assertEquals(0, world.worldLookups.get());
    }

    @Test
    void handlesSingleBlockRegion() {
        FakeCollisionWorld world = new FakeCollisionWorld();
        world.setHeight(5, 10, 72);

        CollisionReader.Found found = assertInstanceOf(
                CollisionReader.Found.class,
                new CollisionReader(world).read("minecraft:overworld", 5, 10, 5, 10)
        );

        assertEquals(1, found.width());
        assertEquals(1, found.depth());
        assertArrayEquals(new int[]{72}, found.heights());
    }

    private static final class FakeCollisionWorld implements CollisionReader.WorldAccess, CollisionReader.WorldView {
        private final AtomicInteger worldLookups = new AtomicInteger();
        private final AtomicInteger heightmapReads = new AtomicInteger();
        private boolean worldAvailable = true;
        private int defaultHeight = -1;
        private final java.util.Map<Long, Integer> heights = new java.util.HashMap<>();

        void setHeight(int x, int z, int height) {
            heights.put(key(x, z), height);
        }

        @Override
        public Optional<CollisionReader.WorldView> findWorld(Identifier dimension) {
            worldLookups.incrementAndGet();
            return worldAvailable && Identifier.of("minecraft", "overworld").equals(dimension)
                    ? Optional.of(this)
                    : Optional.empty();
        }

        @Override
        public int sampleHeightmap(int x, int z) {
            heightmapReads.incrementAndGet();
            return heights.getOrDefault(key(x, z), defaultHeight);
        }

        private static long key(int x, int z) {
            return ((long) x << 32) | (z & 0xFFFFFFFFL);
        }
    }
}
