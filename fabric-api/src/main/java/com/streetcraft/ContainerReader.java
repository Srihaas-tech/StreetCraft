package com.streetcraft;

import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.ChestBlock;
import net.minecraft.block.entity.BarrelBlockEntity;
import net.minecraft.block.entity.ShulkerBoxBlockEntity;
import net.minecraft.block.enums.ChestType;
import net.minecraft.inventory.Inventory;
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
import java.util.Set;

/** Performs a synchronous, read-only container snapshot. */
public final class ContainerReader {
    private static final Set<Block> VANILLA_SHULKER_BOXES = Set.of(
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

    private final WorldAccess worldAccess;
    private final InventorySerializer serializer;

    ContainerReader(WorldAccess worldAccess, InventorySerializer serializer) {
        this.worldAccess = Objects.requireNonNull(worldAccess, "worldAccess");
        this.serializer = Objects.requireNonNull(serializer, "serializer");
    }

    /**
     * Creates a live reader. Calls to {@link #read(String, int, int, int)} on this reader must run
     * on the Minecraft server thread; the backing adapter enforces that expectation.
     */
    public static ContainerReader fromServer(MinecraftServer server) {
        return new ContainerReader(new MinecraftWorldAccess(server), new InventorySerializer());
    }

    /**
     * Copies all allowlisted data before returning and never exposes the live inventory reference.
     * A reader returned by {@link #fromServer(MinecraftServer)} must be invoked on the server thread.
     */
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

        WorldView world = maybeWorld.get();
        BlockPos position = new BlockPos(x, y, z);
        if (!world.isPositionLoaded(position)) {
            return new NotFound();
        }
        BlockState state = world.getBlockState(position);
        Block block = state.getBlock();

        if (state.isAir()) {
            return new NotFound();
        }

        if (block == Blocks.CHEST || block == Blocks.TRAPPED_CHEST) {
            if (state.get(ChestBlock.CHEST_TYPE) != ChestType.SINGLE
                    && !world.isPositionLoaded(position.offset(ChestBlock.getFacing(state)))) {
                return new NotFound();
            }
            Optional<Inventory> inventory = world.getChestInventory(position);
            if (inventory.isEmpty()) {
                return new NotFound();
            }
            InventorySerializer.ContainerType type = inventory.get().size() == 54
                    ? InventorySerializer.ContainerType.DOUBLE_CHEST
                    : InventorySerializer.ContainerType.CHEST;
            return serializeSupported(block, type, inventory.get());
        }

        if (block == Blocks.BARREL) {
            return readBlockEntityInventory(
                    block,
                    InventorySerializer.ContainerType.BARREL,
                    world.getBarrelInventory(position)
            );
        }

        if (VANILLA_SHULKER_BOXES.contains(block)) {
            return readBlockEntityInventory(
                    block,
                    InventorySerializer.ContainerType.SHULKER_BOX,
                    world.getShulkerInventory(position)
            );
        }

        return new Unsupported(Registries.BLOCK.getId(block).toString());
    }

    private ReadResult readBlockEntityInventory(
            Block block,
            InventorySerializer.ContainerType type,
            Optional<Inventory> inventory
    ) {
        return inventory.<ReadResult>map(value -> serializeSupported(block, type, value))
                .orElseGet(NotFound::new);
    }

    private ReadResult serializeSupported(
            Block block,
            InventorySerializer.ContainerType type,
            Inventory inventory
    ) {
        if (inventory.size() != type.size()) {
            return new Unsupported(Registries.BLOCK.getId(block).toString());
        }
        return new Found(serializer.serialize(type, inventory));
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(Identifier dimension);
    }

    interface WorldView {
        boolean isPositionLoaded(BlockPos position);

        BlockState getBlockState(BlockPos position);

        Optional<Inventory> getChestInventory(BlockPos position);

        Optional<Inventory> getBarrelInventory(BlockPos position);

        Optional<Inventory> getShulkerInventory(BlockPos position);
    }

    public sealed interface ReadResult permits Found, NotFound, Unsupported, InvalidDimension {
    }

    public record Found(InventorySerializer.SerializedInventory inventory) implements ReadResult {
        public Found {
            Objects.requireNonNull(inventory, "inventory");
        }
    }

    public record NotFound() implements ReadResult {
    }

    public record Unsupported(String blockId) implements ReadResult {
        public Unsupported {
            Objects.requireNonNull(blockId, "blockId");
        }
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
                throw new IllegalStateException("Container reads must run on the Minecraft server thread");
            }

            RegistryKey<World> worldKey = RegistryKey.of(RegistryKeys.WORLD, dimension);
            ServerWorld world = server.getWorld(worldKey);
            return Optional.ofNullable(world).map(MinecraftWorldView::new);
        }
    }

    private record MinecraftWorldView(ServerWorld world) implements WorldView {
        @Override
        public boolean isPositionLoaded(BlockPos position) {
            int chunkX = Math.floorDiv(position.getX(), 16);
            int chunkZ = Math.floorDiv(position.getZ(), 16);
            return world.getChunkManager().isChunkLoaded(chunkX, chunkZ);
        }

        @Override
        public BlockState getBlockState(BlockPos position) {
            return world.getBlockState(position);
        }

        @Override
        public Optional<Inventory> getChestInventory(BlockPos position) {
            BlockState state = world.getBlockState(position);
            if (!(state.getBlock() instanceof ChestBlock chestBlock)) {
                return Optional.empty();
            }
            return Optional.ofNullable(ChestBlock.getInventory(chestBlock, state, world, position, true));
        }

        @Override
        public Optional<Inventory> getBarrelInventory(BlockPos position) {
            return world.getBlockEntity(position) instanceof BarrelBlockEntity barrel
                    ? Optional.of(barrel)
                    : Optional.empty();
        }

        @Override
        public Optional<Inventory> getShulkerInventory(BlockPos position) {
            return world.getBlockEntity(position) instanceof ShulkerBoxBlockEntity shulker
                    ? Optional.of(shulker)
                    : Optional.empty();
        }
    }
}
