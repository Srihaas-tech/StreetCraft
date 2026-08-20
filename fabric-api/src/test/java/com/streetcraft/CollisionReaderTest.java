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
    void returnsOnlyActuallyCollidableBlocksForAValidRegion() {
        FakeCollisionWorld world = new FakeCollisionWorld();
        world.setCollisionBlocks(new int[]{10, 63, 20, 11, 64, 21});

        CollisionReader.Found found = assertInstanceOf(
                CollisionReader.Found.class,
                new CollisionReader(world).read("minecraft:overworld", 10, 20, 11, 21)
        );

        assertEquals("minecraft:overworld", found.dimension());
        assertEquals(10, found.fromX());
        assertEquals(20, found.fromZ());
        assertArrayEquals(new int[]{10, 63, 20, 11, 64, 21}, found.blocks());
        assertEquals(1, world.collisionReads.get());
    }

    @Test
    void returnsNotFoundWhenDimensionIsUnavailable() {
        FakeCollisionWorld world = new FakeCollisionWorld();
        world.worldAvailable = false;

        assertInstanceOf(CollisionReader.NotFound.class,
                new CollisionReader(world).read("minecraft:the_nether", 0, 0, 0, 0));
        assertEquals(0, world.collisionReads.get());
    }

    @Test
    void rejectsMalformedDimensionsBeforeWorldAccess() {
        FakeCollisionWorld world = new FakeCollisionWorld();

        assertInstanceOf(CollisionReader.InvalidDimension.class,
                new CollisionReader(world).read("Minecraft:Overworld", 0, 0, 0, 0));
        assertEquals(0, world.worldLookups.get());
    }

    @Test
    void preservesAnEmptyRegionWithoutInventingSolidColumns() {
        FakeCollisionWorld world = new FakeCollisionWorld();

        CollisionReader.Found found = assertInstanceOf(
                CollisionReader.Found.class,
                new CollisionReader(world).read("minecraft:overworld", 5, 10, 5, 10)
        );

        assertArrayEquals(new int[0], found.blocks());
    }

    private static final class FakeCollisionWorld implements CollisionReader.WorldAccess, CollisionReader.WorldView {
        private final AtomicInteger worldLookups = new AtomicInteger();
        private final AtomicInteger collisionReads = new AtomicInteger();
        private boolean worldAvailable = true;
        private int[] blocks = new int[0];

        void setCollisionBlocks(int[] blocks) {
            this.blocks = blocks;
        }

        @Override
        public Optional<CollisionReader.WorldView> findWorld(Identifier dimension) {
            worldLookups.incrementAndGet();
            return worldAvailable && Identifier.of("minecraft", "overworld").equals(dimension)
                    ? Optional.of(this)
                    : Optional.empty();
        }

        @Override
        public int[] collisionBlocks(int fromX, int fromZ, int toX, int toZ) {
            collisionReads.incrementAndGet();
            return blocks;
        }
    }
}
