package com.streetcraft;

import org.bukkit.Material;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/** Copies the public, allowlisted portion of an inventory into immutable DTOs. */
public final class InventorySerializer {
    static final int MAX_DISPLAY_NAME_CODE_POINTS = 256;
    private static final int MAX_DISPLAY_NAME_UTF16_UNITS = MAX_DISPLAY_NAME_CODE_POINTS * 2;
    private static final int MAX_ITEM_STACK_COUNT = 64;

    public SerializedInventory serialize(ContainerType containerType, Inventory inventory) {
        Objects.requireNonNull(containerType, "containerType");
        Objects.requireNonNull(inventory, "inventory");
        if (inventory.getSize() != containerType.size()) {
            throw new IllegalArgumentException(
                    containerType.wireName() + " requires " + containerType.size()
                            + " slots, but inventory has " + inventory.getSize()
            );
        }

        List<SerializedItemStack> items = new ArrayList<>();
        for (int slot = 0; slot < inventory.getSize(); slot++) {
            ItemStack stack = inventory.getItem(slot);
            if (stack == null || isEmpty(stack)) {
                continue;
            }

            int count = stack.getAmount();
            if (count <= 0 || count > MAX_ITEM_STACK_COUNT) {
                throw new IllegalArgumentException("Invalid stack count " + count + " in slot " + slot);
            }

            items.add(new SerializedItemStack(
                    slot,
                    materialId(stack),
                    count,
                    displayNameOf(stack),
                    new SafeTooltipData(stack.getDurability(), stack.getType().getMaxDurability(), hasGlint(stack))
            ));
        }

        return new SerializedInventory(containerType.wireName(), inventory.getSize(), items);
    }

    private static boolean isEmpty(ItemStack stack) {
        Material type = stack.getType();
        return type == Material.AIR || stack.getAmount() <= 0;
    }

    private static boolean hasGlint(ItemStack stack) {
        if (!stack.getEnchantments().isEmpty()) {
            return true;
        }
        Material material = stack.getType();
        return material == Material.ENCHANTED_GOLDEN_APPLE || material == Material.SPECTRAL_ARROW;
    }

    /** Portable vanilla item identifier, e.g. {@code minecraft:iron_pickaxe}. */
    static String materialId(ItemStack stack) {
        return materialId(stack.getType());
    }

    static String materialId(Material material) {
        return "minecraft:" + material.name().toLowerCase(Locale.ROOT);
    }

    private static String displayNameOf(ItemStack stack) {
        ItemMeta meta = stack.getItemMeta();
        String rawName = null;
        if (meta != null && meta.hasDisplayName()) {
            rawName = meta.getDisplayName();
        } else {
            try {
                rawName = stack.getI18NDisplayName();
            } catch (RuntimeException unavailable) {
                rawName = materialId(stack);
            }
        }
        return sanitizeDisplayName(truncateUtf16(stripLegacyFormatting(rawName), MAX_DISPLAY_NAME_UTF16_UNITS));
    }

    /** Removes legacy {@code section} formatting codes to avoid leaking style into JSON or HTML. */
    static String stripLegacyFormatting(String input) {
        if (input != null && input.indexOf('\u00A7') >= 0) {
            StringBuilder stripped = new StringBuilder(input.length());
            for (int index = 0; index < input.length(); index++) {
                char character = input.charAt(index);
                if (character == '\u00A7') {
                    if (index + 1 < input.length()) {
                        index++;
                    }
                    continue;
                }
                stripped.append(character);
            }
            return stripped.toString();
        }
        return input;
    }

    private static String truncateUtf16(String input, int maxUnits) {
        if (input == null) {
            return "";
        }
        return input.length() <= maxUnits ? input : input.substring(0, maxUnits);
    }

    static String sanitizeDisplayName(String input) {
        StringBuilder sanitized = new StringBuilder(Math.min(input.length(), MAX_DISPLAY_NAME_CODE_POINTS));
        input.codePoints()
                .filter(codePoint -> !Character.isISOControl(codePoint)
                        && Character.getType(codePoint) != Character.FORMAT
                        && (codePoint < Character.MIN_SURROGATE || codePoint > Character.MAX_SURROGATE))
                .limit(MAX_DISPLAY_NAME_CODE_POINTS)
                .forEach(sanitized::appendCodePoint);
        return sanitized.toString();
    }

    public enum ContainerType {
        CHEST("chest", 27),
        DOUBLE_CHEST("double_chest", 54),
        BARREL("barrel", 27),
        SHULKER_BOX("shulker_box", 27);

        private final String wireName;
        private final int size;

        ContainerType(String wireName, int size) {
            this.wireName = wireName;
            this.size = size;
        }

        public String wireName() {
            return wireName;
        }

        public int size() {
            return size;
        }
    }

    public static final class SerializedInventory {
        private final String containerType;
        private final int size;
        private final List<SerializedItemStack> items;

        public SerializedInventory(String containerType, int size, List<SerializedItemStack> items) {
            this.containerType = Objects.requireNonNull(containerType, "containerType");
            if (size <= 0) {
                throw new IllegalArgumentException("size must be positive");
            }
            this.items = Collections.unmodifiableList(new ArrayList<>(Objects.requireNonNull(items, "items")));
            this.size = size;
        }

        public String containerType() {
            return containerType;
        }

        public int size() {
            return size;
        }

        public List<SerializedItemStack> items() {
            return items;
        }
    }

    public static final class SerializedItemStack {
        private final int slot;
        private final String itemId;
        private final int count;
        private final String displayName;
        private final SafeTooltipData safeTooltipData;

        public SerializedItemStack(
                int slot,
                String itemId,
                int count,
                String displayName,
                SafeTooltipData safeTooltipData
        ) {
            if (slot < 0) {
                throw new IllegalArgumentException("slot must not be negative");
            }
            if (count <= 0) {
                throw new IllegalArgumentException("count must be positive");
            }
            this.slot = slot;
            this.itemId = Objects.requireNonNull(itemId, "itemId");
            this.count = count;
            this.displayName = Objects.requireNonNull(displayName, "displayName");
            this.safeTooltipData = Objects.requireNonNull(safeTooltipData, "safeTooltipData");
        }

        public int slot() {
            return slot;
        }

        public String itemId() {
            return itemId;
        }

        public int count() {
            return count;
        }

        public String displayName() {
            return displayName;
        }

        public SafeTooltipData safeTooltipData() {
            return safeTooltipData;
        }
    }

    public static final class SafeTooltipData {
        private final int damage;
        private final int maxDamage;
        private final boolean glint;

        public SafeTooltipData(int damage, int maxDamage, boolean glint) {
            if (damage < 0 || maxDamage < 0 || damage > maxDamage) {
                throw new IllegalArgumentException("invalid damage values");
            }
            this.damage = damage;
            this.maxDamage = maxDamage;
            this.glint = glint;
        }

        public int damage() {
            return damage;
        }

        public int maxDamage() {
            return maxDamage;
        }

        public boolean glint() {
            return glint;
        }
    }
}