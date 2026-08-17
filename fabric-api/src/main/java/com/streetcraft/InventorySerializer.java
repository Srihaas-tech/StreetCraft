package com.streetcraft;

import net.minecraft.inventory.Inventory;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Copies the public, allowlisted portion of an inventory into immutable DTOs. */
public final class InventorySerializer {
    static final int MAX_DISPLAY_NAME_CODE_POINTS = 256;
    private static final int MAX_DISPLAY_NAME_UTF16_UNITS = MAX_DISPLAY_NAME_CODE_POINTS * 2;

    public SerializedInventory serialize(ContainerType containerType, Inventory inventory) {
        Objects.requireNonNull(containerType, "containerType");
        Objects.requireNonNull(inventory, "inventory");
        if (inventory.size() != containerType.size()) {
            throw new IllegalArgumentException(
                    containerType.wireName() + " requires " + containerType.size()
                            + " slots, but inventory has " + inventory.size()
            );
        }

        List<SerializedItemStack> items = new ArrayList<>();
        for (int slot = 0; slot < inventory.size(); slot++) {
            ItemStack stack = inventory.getStack(slot);
            if (stack.isEmpty()) {
                continue;
            }

            int count = stack.getCount();
            if (count <= 0 || count > stack.getMaxCount()) {
                throw new IllegalArgumentException("Invalid stack count " + count + " in slot " + slot);
            }

            String itemId = Registries.ITEM.getId(stack.getItem()).toString();
            items.add(new SerializedItemStack(
                    slot,
                    itemId,
                    count,
                    sanitizeDisplayName(stack.getName().asTruncatedString(MAX_DISPLAY_NAME_UTF16_UNITS)),
                    new SafeTooltipData(stack.getDamage(), stack.getMaxDamage(), stack.hasGlint())
            ));
        }

        return new SerializedInventory(containerType.wireName(), inventory.size(), items);
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

    public record SerializedInventory(String containerType, int size, List<SerializedItemStack> items) {
        public SerializedInventory {
            Objects.requireNonNull(containerType, "containerType");
            if (size <= 0) {
                throw new IllegalArgumentException("size must be positive");
            }
            items = List.copyOf(items);
        }
    }

    public record SerializedItemStack(
            int slot,
            String itemId,
            int count,
            String displayName,
            SafeTooltipData safeTooltipData
    ) {
        public SerializedItemStack {
            if (slot < 0) {
                throw new IllegalArgumentException("slot must not be negative");
            }
            if (count <= 0) {
                throw new IllegalArgumentException("count must be positive");
            }
            Objects.requireNonNull(itemId, "itemId");
            Objects.requireNonNull(displayName, "displayName");
            Objects.requireNonNull(safeTooltipData, "safeTooltipData");
        }
    }

    public record SafeTooltipData(int damage, int maxDamage, boolean glint) {
        public SafeTooltipData {
            if (damage < 0 || maxDamage < 0 || damage > maxDamage) {
                throw new IllegalArgumentException("invalid damage values");
            }
        }
    }
}
