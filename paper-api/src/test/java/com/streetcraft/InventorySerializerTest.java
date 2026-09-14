package com.streetcraft;

import org.bukkit.Material;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Pure logic tests; server-backed serialization is covered by live integration tests. */
class InventorySerializerTest {
    @Test
    void sanitizesControlCharactersAndCapsVisibleNamesAt256UnicodeCodePoints() {
        String hostileName = repeat("x", 255) + "\u0000\u0007\u202E" + "\uD83D\uDE80" + "ignored";

        String displayName = InventorySerializer.sanitizeDisplayName(
                InventorySerializer.stripLegacyFormatting(hostileName));

        assertEquals(256, displayName.codePointCount(0, displayName.length()));
        assertEquals(repeat("x", 255) + "\uD83D\uDE80", displayName);
        assertTrue(displayName.codePoints().noneMatch(Character::isISOControl));
        assertTrue(displayName.codePoints()
                .noneMatch(codePoint -> Character.getType(codePoint) == Character.FORMAT));
    }

    @Test
    void stripsLegacyFormattingCodesBeforeSanitizingDisplayNames() {
        String formatted = "\u00A7o\u00A7aPolished \u00A7bDiamond";

        assertEquals("Polished Diamond", InventorySerializer.stripLegacyFormatting(formatted));
    }

    @Test
    void truncatesTo256UnicodeCodePointsEvenWhenUtf16UnitsWereCapped() {
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < 300; index++) {
            builder.append('x');
        }

        String displayName = InventorySerializer.sanitizeDisplayName(builder.toString());

        assertEquals(256, displayName.codePointCount(0, displayName.length()));
    }

    @Test
    void dropsAnUnpairedSurrogateCreatedAtABoundary() {
        String boundaryName = repeat("\u0001", 511) + "\uD83D\uDE80";

        String displayName = InventorySerializer.sanitizeDisplayName(
                InventorySerializer.stripLegacyFormatting(boundaryName.substring(0, Math.min(boundaryName.length(), 512))));

        assertTrue(displayName.isEmpty());
    }

    @Test
    void mapsMaterialsToVanillaRegistryIds() {
        assertEquals("minecraft:iron_pickaxe", InventorySerializer.materialId(Material.IRON_PICKAXE));
        assertEquals("minecraft:chest", InventorySerializer.materialId(Material.CHEST));
        assertEquals("minecraft:light_gray_shulker_box", InventorySerializer.materialId(Material.LIGHT_GRAY_SHULKER_BOX));
    }

    @Test
    void exposesOnlyAllowlistedDtoFields() {
        List<Class<?>> productionTypes = Arrays.asList(
                InventorySerializer.SerializedInventory.class,
                InventorySerializer.SerializedItemStack.class,
                InventorySerializer.SafeTooltipData.class
        );

        for (Class<?> dtoType : productionTypes) {
            for (Field field : dtoType.getDeclaredFields()) {
                Class<?> fieldType = field.getType();
                assertFalse(
                        fieldType == Object.class || fieldType == Material.class
                                || Map.class.isAssignableFrom(fieldType),
                        () -> dtoType.getSimpleName() + "." + field.getName() + " exposes " + fieldType
                );
            }
        }
    }

    @Test
    void inventoryItemsSurviveDefensiveCopying() {
        InventorySerializer.SerializedInventory inventory = new InventorySerializer.SerializedInventory(
                "barrel",
                27,
                Arrays.asList(new InventorySerializer.SerializedItemStack(
                        0, "minecraft:stone", 1, "Stone", new InventorySerializer.SafeTooltipData(0, 0, false)
                ))
        );

        assertThrows(UnsupportedOperationException.class, () -> inventory.items().clear());
        assertEquals(1, inventory.items().size());
        assertEquals("barrel", inventory.containerType());
        assertEquals(27, inventory.size());
    }

    private static String repeat(String value, int count) {
        StringBuilder builder = new StringBuilder(count * value.length());
        for (int index = 0; index < count; index++) {
            builder.append(value);
        }
        return builder.toString();
    }
}