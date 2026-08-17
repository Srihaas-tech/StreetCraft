package com.streetcraft;

import net.minecraft.block.Block;
import net.minecraft.block.AbstractBlock;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.ChestBlock;
import net.minecraft.block.ShulkerBoxBlock;
import net.minecraft.block.enums.ChestType;
import net.minecraft.inventory.Inventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.Identifier;
import net.minecraft.util.DyeColor;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.BlockPos;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ContainerReaderTest {
    private static final Identifier OVERWORLD = Identifier.ofVanilla("overworld");
    private static final BlockPos TARGET = new BlockPos(12, 64, -7);

    @BeforeAll
    static void bootstrapMinecraftRegistries() {
        MinecraftTestBootstrap.initialize();
    }

    @Test
    void readsA27SlotChestAtTheExactDimensionAndCoordinates() {
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(6, new ItemStack(Items.APPLE, 5));
        InMemoryWorldAccess world = new InMemoryWorldAccess(OVERWORLD, TARGET, Blocks.CHEST.getDefaultState(), inventory);

        ContainerReader.Found found = found(new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ()));

        assertEquals("chest", found.inventory().containerType());
        assertEquals(27, found.inventory().size());
        assertEquals(6, found.inventory().items().getFirst().slot());
        assertEquals(5, found.inventory().items().getFirst().count());
        assertEquals(OVERWORLD, world.requestedDimension);
        assertEquals(TARGET, world.requestedPosition);
        assertEquals(1, world.chestInventoryReads);
        assertEquals(0, world.blockEntityInventoryReads);
    }

    @Test
    void preservesTheSupported54SlotDoubleChestOrdering() {
        SimpleInventory composedInventory = new SimpleInventory(54);
        composedInventory.setStack(0, new ItemStack(Items.STONE, 1));
        composedInventory.setStack(27, new ItemStack(Items.GOLD_INGOT, 2));
        composedInventory.setStack(53, new ItemStack(Items.EMERALD, 3));
        InMemoryWorldAccess world = new InMemoryWorldAccess(
                OVERWORLD,
                TARGET,
                Blocks.TRAPPED_CHEST.getDefaultState(),
                composedInventory
        );

        ContainerReader.Found found = found(new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ()));

        assertEquals("double_chest", found.inventory().containerType());
        assertEquals(54, found.inventory().size());
        assertEquals(0, found.inventory().items().get(0).slot());
        assertEquals(27, found.inventory().items().get(1).slot());
        assertEquals(53, found.inventory().items().get(2).slot());
    }

    @Test
    void readsABarrelAsExactly27Slots() {
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(11, new ItemStack(Items.CARROT, 7));
        InMemoryWorldAccess world = new InMemoryWorldAccess(OVERWORLD, TARGET, Blocks.BARREL.getDefaultState(), inventory);

        ContainerReader.Found found = found(new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ()));

        assertEquals("barrel", found.inventory().containerType());
        assertEquals(27, found.inventory().size());
        assertEquals(11, found.inventory().items().getFirst().slot());
        assertEquals(0, world.chestInventoryReads);
        assertEquals(1, world.blockEntityInventoryReads);
    }

    @Test
    void readsEveryVanillaShulkerColorAsExactly27Slots() {
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(2, new ItemStack(Items.REDSTONE, 19));
        List<Block> shulkerBoxes = List.of(
                Blocks.SHULKER_BOX,
                Blocks.WHITE_SHULKER_BOX,
                Blocks.LIGHT_GRAY_SHULKER_BOX,
                Blocks.GRAY_SHULKER_BOX,
                Blocks.BLACK_SHULKER_BOX,
                Blocks.BROWN_SHULKER_BOX,
                Blocks.RED_SHULKER_BOX,
                Blocks.ORANGE_SHULKER_BOX,
                Blocks.YELLOW_SHULKER_BOX,
                Blocks.LIME_SHULKER_BOX,
                Blocks.GREEN_SHULKER_BOX,
                Blocks.CYAN_SHULKER_BOX,
                Blocks.LIGHT_BLUE_SHULKER_BOX,
                Blocks.BLUE_SHULKER_BOX,
                Blocks.PURPLE_SHULKER_BOX,
                Blocks.MAGENTA_SHULKER_BOX,
                Blocks.PINK_SHULKER_BOX
        );

        for (Block shulkerBox : shulkerBoxes) {
            InMemoryWorldAccess world = new InMemoryWorldAccess(
                    OVERWORLD,
                    TARGET,
                    shulkerBox.getDefaultState(),
                    inventory
            );
            ContainerReader.Found found = found(new ContainerReader(world, new InventorySerializer())
                    .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ()));

            assertEquals("shulker_box", found.inventory().containerType());
            assertEquals(27, found.inventory().size());
            assertEquals("minecraft:redstone", found.inventory().items().getFirst().itemId());
        }
    }

    @Test
    void rejectsInvalidDimensionIdentifiersWithoutConsultingWorldAccess() {
        InMemoryWorldAccess world = new InMemoryWorldAccess(
                OVERWORLD,
                TARGET,
                Blocks.CHEST.getDefaultState(),
                new SimpleInventory(27)
        );

        ContainerReader.ReadResult result = new ContainerReader(world, new InventorySerializer())
                .read("NOT A VALID DIMENSION", TARGET.getX(), TARGET.getY(), TARGET.getZ());

        assertInstanceOf(ContainerReader.InvalidDimension.class, result);
        assertEquals(0, world.worldLookups);

        assertInstanceOf(
                ContainerReader.InvalidDimension.class,
                new ContainerReader(world, new InventorySerializer())
                        .read(null, TARGET.getX(), TARGET.getY(), TARGET.getZ())
        );
        assertEquals(0, world.worldLookups);
    }

    @Test
    void returnsNotFoundForAnAbsentDimensionOrBlock() {
        InMemoryWorldAccess missingDimension = InMemoryWorldAccess.missing(OVERWORLD);
        ContainerReader reader = new ContainerReader(missingDimension, new InventorySerializer());

        assertInstanceOf(
                ContainerReader.NotFound.class,
                reader.read("minecraft:the_nether", TARGET.getX(), TARGET.getY(), TARGET.getZ())
        );

        InMemoryWorldAccess air = new InMemoryWorldAccess(
                OVERWORLD,
                TARGET,
                Blocks.AIR.getDefaultState(),
                null
        );
        assertInstanceOf(
                ContainerReader.NotFound.class,
                new ContainerReader(air, new InventorySerializer())
                        .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ())
        );
    }

    @Test
    void returnsNotFoundWithoutReadingAnUnloadedTargetChunk() {
        InMemoryWorldAccess world = new InMemoryWorldAccess(
                OVERWORLD,
                TARGET,
                Blocks.BARREL.getDefaultState(),
                new SimpleInventory(27)
        );
        world.unloadedPosition = TARGET;

        ContainerReader.ReadResult result = new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ());

        assertInstanceOf(ContainerReader.NotFound.class, result);
        assertEquals(1, world.loadedBlockStateReads);
        assertEquals(0, world.blockEntityInventoryReads);
    }

    @Test
    void returnsNotFoundBeforeComposingADoubleChestWhoseOtherChunkIsUnloaded() {
        BlockPos chunkBoundary = new BlockPos(15, 64, 0);
        BlockState leftChest = Blocks.CHEST.getDefaultState()
                .with(ChestBlock.FACING, Direction.NORTH)
                .with(ChestBlock.CHEST_TYPE, ChestType.LEFT);
        BlockPos adjacentHalf = chunkBoundary.offset(ChestBlock.getFacing(leftChest));
        InMemoryWorldAccess world = new InMemoryWorldAccess(
                OVERWORLD,
                chunkBoundary,
                leftChest,
                new SimpleInventory(54)
        );
        world.unloadedPosition = adjacentHalf;

        ContainerReader.ReadResult result = new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", chunkBoundary.getX(), chunkBoundary.getY(), chunkBoundary.getZ());

        assertInstanceOf(ContainerReader.NotFound.class, result);
        assertEquals(2, world.loadedBlockStateReads);
        assertEquals(0, world.chestInventoryReads);
    }

    @Test
    void rejectsUnsupportedInventoryBlocksWithoutAccessingOrMutatingTheirInventory() {
        SimpleInventory hopperInventory = new SimpleInventory(5);
        ItemStack liveStack = new ItemStack(Items.DIAMOND, 2);
        hopperInventory.setStack(0, liveStack);
        ItemStack before = liveStack.copy();
        InMemoryWorldAccess world = new InMemoryWorldAccess(
                OVERWORLD,
                TARGET,
                Blocks.HOPPER.getDefaultState(),
                hopperInventory
        );

        ContainerReader.ReadResult result = new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ());

        ContainerReader.Unsupported unsupported = assertInstanceOf(ContainerReader.Unsupported.class, result);
        assertEquals("minecraft:hopper", unsupported.blockId());
        assertEquals(0, world.chestInventoryReads);
        assertEquals(0, world.blockEntityInventoryReads);
        assertTrue(ItemStack.areEqual(before, hopperInventory.getStack(0)));
    }

    @Test
    void rejectsModdedShulkerSubclassesAndTheirArbitraryInventories() {
        Block moddedShulker = new ShulkerBoxBlock(
                DyeColor.BLUE,
                AbstractBlock.Settings.copy(Blocks.BLUE_SHULKER_BOX)
        );
        InMemoryWorldAccess world = new InMemoryWorldAccess(
                OVERWORLD,
                TARGET,
                moddedShulker.getDefaultState(),
                new SimpleInventory(27)
        );

        ContainerReader.ReadResult result = new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ());

        assertInstanceOf(ContainerReader.Unsupported.class, result);
        assertEquals(0, world.blockEntityInventoryReads);
    }

    @Test
    void doesNotMutateSupportedLiveInventoryWhileCopyingIt() {
        SimpleInventory inventory = new SimpleInventory(27);
        ItemStack liveStack = new ItemStack(Items.DIAMOND_SWORD, 1);
        liveStack.setDamage(9);
        inventory.setStack(3, liveStack);
        ItemStack before = liveStack.copy();
        InMemoryWorldAccess world = new InMemoryWorldAccess(OVERWORLD, TARGET, Blocks.BARREL.getDefaultState(), inventory);

        found(new ContainerReader(world, new InventorySerializer())
                .read("minecraft:overworld", TARGET.getX(), TARGET.getY(), TARGET.getZ()));

        assertTrue(ItemStack.areEqual(before, inventory.getStack(3)));
        assertEquals(27, inventory.size());
    }

    private static ContainerReader.Found found(ContainerReader.ReadResult result) {
        return assertInstanceOf(ContainerReader.Found.class, result);
    }

    private static final class InMemoryWorldAccess implements ContainerReader.WorldAccess, ContainerReader.WorldView {
        private final Identifier dimension;
        private final BlockPos position;
        private final BlockState state;
        private final Inventory inventory;
        private final boolean exists;
        private int worldLookups;
        private int chestInventoryReads;
        private int blockEntityInventoryReads;
        private int loadedBlockStateReads;
        private Identifier requestedDimension;
        private BlockPos requestedPosition;
        private BlockPos unloadedPosition;

        private InMemoryWorldAccess(
                Identifier dimension,
                BlockPos position,
                BlockState state,
                Inventory inventory
        ) {
            this(dimension, position, state, inventory, true);
        }

        private InMemoryWorldAccess(
                Identifier dimension,
                BlockPos position,
                BlockState state,
                Inventory inventory,
                boolean exists
        ) {
            this.dimension = dimension;
            this.position = position;
            this.state = state;
            this.inventory = inventory;
            this.exists = exists;
        }

        static InMemoryWorldAccess missing(Identifier dimension) {
            return new InMemoryWorldAccess(dimension, TARGET, Blocks.AIR.getDefaultState(), null, false);
        }

        @Override
        public Optional<ContainerReader.WorldView> findWorld(Identifier requestedDimension) {
            worldLookups++;
            this.requestedDimension = requestedDimension;
            return exists && dimension.equals(requestedDimension) ? Optional.of(this) : Optional.empty();
        }

        @Override
        public Optional<BlockState> getLoadedBlockState(BlockPos requestedPosition) {
            loadedBlockStateReads++;
            this.requestedPosition = requestedPosition;
            if (requestedPosition.equals(unloadedPosition)) {
                return Optional.empty();
            }
            return Optional.of(position.equals(requestedPosition) ? state : Blocks.AIR.getDefaultState());
        }

        @Override
        public Optional<Inventory> getChestInventory(BlockPos requestedPosition, BlockState requestedState) {
            chestInventoryReads++;
            this.requestedPosition = requestedPosition;
            return position.equals(requestedPosition) ? Optional.ofNullable(inventory) : Optional.empty();
        }

        @Override
        public Optional<Inventory> getBarrelInventory(BlockPos requestedPosition) {
            blockEntityInventoryReads++;
            this.requestedPosition = requestedPosition;
            return position.equals(requestedPosition) ? Optional.ofNullable(inventory) : Optional.empty();
        }

        @Override
        public Optional<Inventory> getShulkerInventory(BlockPos requestedPosition) {
            blockEntityInventoryReads++;
            this.requestedPosition = requestedPosition;
            return position.equals(requestedPosition) ? Optional.ofNullable(inventory) : Optional.empty();
        }
    }
}
