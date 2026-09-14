package com.streetcraft;

import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.block.Barrel;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.ShulkerBox;
import org.bukkit.inventory.Inventory;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/** Performs a synchronous, read-only container snapshot. */
public final class ContainerReader {
    private static final Set<Material> VANILLA_SHULKER_BOXES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            Material.SHULKER_BOX,
            Material.WHITE_SHULKER_BOX,
            Material.LIGHT_GRAY_SHULKER_BOX,
            Material.GRAY_SHULKER_BOX,
            Material.BLACK_SHULKER_BOX,
            Material.BROWN_SHULKER_BOX,
            Material.RED_SHULKER_BOX,
            Material.ORANGE_SHULKER_BOX,
            Material.YELLOW_SHULKER_BOX,
            Material.LIME_SHULKER_BOX,
            Material.GREEN_SHULKER_BOX,
            Material.CYAN_SHULKER_BOX,
            Material.LIGHT_BLUE_SHULKER_BOX,
            Material.BLUE_SHULKER_BOX,
            Material.PURPLE_SHULKER_BOX,
            Material.MAGENTA_SHULKER_BOX,
            Material.PINK_SHULKER_BOX
    )));

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
    public static ContainerReader fromServer(Server server) {
        return new ContainerReader(new BukkitWorldAccess(server), new InventorySerializer());
    }

    /**
     * Copies all allowlisted data before returning and never exposes the live inventory reference.
     * A reader returned by {@link #fromServer(Server)} must be invoked on the server thread.
     */
    public ReadResult read(String dimensionIdentifier, int x, int y, int z) {
        if (!Identifiers.isValid(dimensionIdentifier)) {
            return new InvalidDimension();
        }

        Optional<WorldView> maybeWorld = worldAccess.findWorld(dimensionIdentifier);
        if (!maybeWorld.isPresent()) {
            return new NotFound();
        }

        WorldView world = maybeWorld.get();
        Optional<Block> maybeBlock = world.getLoadedBlock(x, y, z);
        if (!maybeBlock.isPresent()) {
            return new NotFound();
        }
        Block block = maybeBlock.get();
        Material material = block.getType();

        if (material == Material.AIR) {
            return new NotFound();
        }

        if (material == Material.CHEST || material == Material.TRAPPED_CHEST) {
            return readChest(block);
        }

        if (material == Material.BARREL) {
            return readBlockEntityInventory(material, InventorySerializer.ContainerType.BARREL, block,
                    (org.bukkit.block.BlockState state) -> state instanceof Barrel
                            ? Optional.of(((Barrel) state).getInventory())
                            : Optional.empty());
        }

        if (VANILLA_SHULKER_BOXES.contains(material)) {
            return readBlockEntityInventory(material, InventorySerializer.ContainerType.SHULKER_BOX, block,
                    (org.bukkit.block.BlockState state) -> state instanceof ShulkerBox
                            ? Optional.of(((ShulkerBox) state).getInventory())
                            : Optional.empty());
        }

        return new Unsupported(InventorySerializer.materialId(material));
    }

    static boolean isSupportedBlock(Material material) {
        return material == Material.CHEST
                || material == Material.TRAPPED_CHEST
                || material == Material.BARREL
                || VANILLA_SHULKER_BOXES.contains(material);
    }

    private static boolean isChestMaterial(Material material) {
        return material == Material.CHEST || material == Material.TRAPPED_CHEST;
    }

    private ReadResult readChest(Block block) {
        World world = block.getWorld();
        org.bukkit.block.data.type.Chest data = (org.bukkit.block.data.type.Chest) block.getBlockData();
        if (data.getType() != org.bukkit.block.data.type.Chest.Type.SINGLE && !bothHalvesLoaded(world, block, data)) {
            return new NotFound();
        }

        org.bukkit.block.BlockState state = block.getState();
        if (!(state instanceof Chest)) {
            return new NotFound();
        }
        Inventory inventory = ((Chest) state).getInventory();
        InventorySerializer.ContainerType type = inventory.getSize() == 54
                ? InventorySerializer.ContainerType.DOUBLE_CHEST
                : InventorySerializer.ContainerType.CHEST;
        return serializeSupported(InventorySerializer.materialId(block.getType()), type, inventory);
    }

    private static boolean bothHalvesLoaded(World world, Block block, org.bukkit.block.data.type.Chest data) {
        org.bukkit.block.BlockFace facing = data.getFacing();
        int neighborX = block.getX() + facing.getModX();
        int neighborZ = block.getZ() + facing.getModZ();
        return world.isChunkLoaded(neighborX >> 4, neighborZ >> 4)
                && isChestMaterial(world.getBlockAt(neighborX, block.getY(), neighborZ).getType());
    }

    private ReadResult readBlockEntityInventory(
            Material material,
            InventorySerializer.ContainerType type,
            Block block,
            InventoryLookup lookup
    ) {
        Optional<Inventory> inventory = lookup.find(block.getState());
        if (!inventory.isPresent()) {
            return new NotFound();
        }
        return serializeSupported(InventorySerializer.materialId(material), type, inventory.get());
    }

    private ReadResult serializeSupported(
            String blockId,
            InventorySerializer.ContainerType type,
            Inventory inventory
    ) {
        if (inventory.getSize() != type.size()) {
            return new Unsupported(blockId);
        }
        return new Found(serializer.serialize(type, inventory));
    }

    interface WorldAccess {
        Optional<WorldView> findWorld(String dimensionIdentifier);
    }

    interface WorldView {
        Optional<Block> getLoadedBlock(int x, int y, int z);
    }

    @FunctionalInterface
    private interface InventoryLookup {
        Optional<Inventory> find(org.bukkit.block.BlockState state);
    }

    public interface ReadResult {
    }

    public static final class Found implements ReadResult {
        private final InventorySerializer.SerializedInventory inventory;

        public Found(InventorySerializer.SerializedInventory inventory) {
            this.inventory = Objects.requireNonNull(inventory, "inventory");
        }

        public InventorySerializer.SerializedInventory inventory() {
            return inventory;
        }
    }

    public static final class NotFound implements ReadResult {
    }

    public static final class Unsupported implements ReadResult {
        private final String blockId;

        public Unsupported(String blockId) {
            this.blockId = Objects.requireNonNull(blockId, "blockId");
        }

        public String blockId() {
            return blockId;
        }
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
            PaperWorlds.requireServerThread(server, "Container");
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