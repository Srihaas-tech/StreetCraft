package com.streetcraft;

import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BlockReaderTest {
    @BeforeAll
    static void bootstrapMinecraftRegistries() {
        MinecraftTestBootstrap.initialize();
    }

    @Test
    void returnsExactRegistryIdAndSupportedContainerFlagFromALoadedPosition() {
        FakeWorld world = new FakeWorld(Blocks.TRAPPED_CHEST.getDefaultState());

        BlockReader.Found found = assertInstanceOf(
                BlockReader.Found.class,
                new BlockReader(world).read("minecraft:overworld", 10, 64, -4)
        );

        assertEquals("minecraft:overworld", found.dimension());
        assertEquals(10, found.x());
        assertEquals(64, found.y());
        assertEquals(-4, found.z());
        assertEquals("minecraft:trapped_chest", found.blockId());
        assertTrue(found.supportedContainer());
        assertEquals(1, world.loadedStateReads.get());
    }

    @Test
    void recognizesOnlySupportedV1ContainerBlocks() {
        assertTrue(foundFor(Blocks.BARREL.getDefaultState()).supportedContainer());
        assertTrue(foundFor(Blocks.BLUE_SHULKER_BOX.getDefaultState()).supportedContainer());
        assertFalse(foundFor(Blocks.HOPPER.getDefaultState()).supportedContainer());
        assertFalse(foundFor(Blocks.AIR.getDefaultState()).supportedContainer());
    }

    @Test
    void returnsNotFoundWhenTheWorldOrTargetChunkIsUnavailable() {
        FakeWorld unavailableWorld = new FakeWorld(Blocks.STONE.getDefaultState());
        unavailableWorld.worldAvailable = false;
        FakeWorld unloadedPosition = new FakeWorld(null);

        assertInstanceOf(BlockReader.NotFound.class,
                new BlockReader(unavailableWorld).read("minecraft:the_nether", 1, 2, 3));
        assertEquals(0, unavailableWorld.loadedStateReads.get());
        assertInstanceOf(BlockReader.NotFound.class,
                new BlockReader(unloadedPosition).read("minecraft:overworld", 1, 2, 3));
        assertEquals(1, unloadedPosition.loadedStateReads.get());
    }

    @Test
    void rejectsMalformedDimensionsBeforeWorldAccess() {
        FakeWorld world = new FakeWorld(Blocks.STONE.getDefaultState());

        assertInstanceOf(BlockReader.InvalidDimension.class,
                new BlockReader(world).read("Minecraft:Overworld", 1, 2, 3));

        assertEquals(0, world.worldLookups.get());
    }

    private static BlockReader.Found foundFor(BlockState state) {
        return assertInstanceOf(BlockReader.Found.class,
                new BlockReader(new FakeWorld(state)).read("minecraft:overworld", 1, 2, 3));
    }

    private static final class FakeWorld implements BlockReader.WorldAccess, BlockReader.WorldView {
        private final BlockState state;
        private final AtomicInteger worldLookups = new AtomicInteger();
        private final AtomicInteger loadedStateReads = new AtomicInteger();
        private boolean worldAvailable = true;

        private FakeWorld(BlockState state) {
            this.state = state;
        }

        @Override
        public Optional<BlockReader.WorldView> findWorld(Identifier dimension) {
            worldLookups.incrementAndGet();
            return worldAvailable && Identifier.of("minecraft", "overworld").equals(dimension)
                    ? Optional.of(this)
                    : Optional.empty();
        }

        @Override
        public Optional<BlockState> getLoadedBlockState(BlockPos position) {
            loadedStateReads.incrementAndGet();
            return Optional.ofNullable(state);
        }
    }
}
