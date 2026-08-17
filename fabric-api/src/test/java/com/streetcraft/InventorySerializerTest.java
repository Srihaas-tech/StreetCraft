package com.streetcraft;

import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.ContainerComponent;
import net.minecraft.component.type.LoreComponent;
import net.minecraft.component.type.NbtComponent;
import net.minecraft.inventory.Inventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.text.MutableText;
import net.minecraft.text.StringVisitable;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TextContent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InventorySerializerTest {
    private final InventorySerializer serializer = new InventorySerializer();

    @BeforeAll
    static void bootstrapMinecraftRegistries() {
        MinecraftTestBootstrap.initialize();
    }

    @Test
    void serializesExactSlotsCountsAndVisibleNamesWhileOmittingEmptySlots() {
        SimpleInventory inventory = new SimpleInventory(27);
        ItemStack diamond = new ItemStack(Items.DIAMOND, 12);
        diamond.set(DataComponentTypes.CUSTOM_NAME, Text.literal("Polished Diamond"));
        inventory.setStack(4, diamond);
        inventory.setStack(26, new ItemStack(Items.OAK_PLANKS, 64));

        InventorySerializer.SerializedInventory result = serializer.serialize(
                InventorySerializer.ContainerType.CHEST,
                inventory
        );

        assertEquals("chest", result.containerType());
        assertEquals(27, result.size());
        assertEquals(2, result.items().size());
        assertEquals(4, result.items().get(0).slot());
        assertEquals("minecraft:diamond", result.items().get(0).itemId());
        assertEquals(12, result.items().get(0).count());
        assertEquals("Polished Diamond", result.items().get(0).displayName());
        assertEquals(26, result.items().get(1).slot());
        assertEquals("minecraft:oak_planks", result.items().get(1).itemId());
        assertEquals(64, result.items().get(1).count());
    }

    @Test
    void sanitizesControlCharactersAndCapsVisibleNamesAt256UnicodeCodePoints() {
        String hostileName = "x".repeat(255) + "\u0000\u0007\u202E" + "\uD83D\uDE80" + "ignored";
        ItemStack stack = new ItemStack(Items.DIAMOND);
        stack.set(DataComponentTypes.CUSTOM_NAME, Text.literal(hostileName));
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(0, stack);

        String displayName = serializer.serialize(InventorySerializer.ContainerType.CHEST, inventory)
                .items().getFirst().displayName();

        assertEquals(256, displayName.codePointCount(0, displayName.length()));
        assertEquals("x".repeat(255) + "\uD83D\uDE80", displayName);
        assertTrue(displayName.codePoints().noneMatch(Character::isISOControl));
        assertTrue(displayName.codePoints().noneMatch(codePoint -> Character.getType(codePoint) == Character.FORMAT));
    }

    @Test
    void boundsCustomTextTraversalBeforeSanitizingTheDisplayName() {
        AtomicInteger visitedSegments = new AtomicInteger();
        MutableText hostileName = MutableText.of(new CountingTextContent("x".repeat(64), visitedSegments));
        for (int index = 0; index < 10_000; index++) {
            hostileName.append(MutableText.of(new CountingTextContent("y".repeat(64), visitedSegments)));
        }
        ItemStack stack = new ItemStack(Items.DIAMOND);
        stack.set(DataComponentTypes.CUSTOM_NAME, hostileName);
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(0, stack);

        String displayName = serializer.serialize(InventorySerializer.ContainerType.CHEST, inventory)
                .items().getFirst().displayName();

        assertEquals(256, displayName.codePointCount(0, displayName.length()));
        assertTrue(visitedSegments.get() < 20, () -> "visited " + visitedSegments.get() + " text segments");
    }

    @Test
    void dropsAnUnpairedSurrogateCreatedAtTheBoundedTextBoundary() {
        String boundaryName = "\u0001".repeat(511) + "\uD83D\uDE80";
        ItemStack stack = new ItemStack(Items.DIAMOND);
        stack.set(DataComponentTypes.CUSTOM_NAME, Text.literal(boundaryName));
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(0, stack);

        String displayName = serializer.serialize(InventorySerializer.ContainerType.CHEST, inventory)
                .items().getFirst().displayName();

        assertEquals("", displayName);
        assertTrue(displayName.chars().noneMatch(character -> Character.isSurrogate((char) character)));
    }

    @Test
    void exposesOnlyAllowlistedScalarsWhenAStackContainsArbitraryComponents() {
        ItemStack stack = new ItemStack(Items.SHULKER_BOX, 1);
        NbtCompound arbitraryData = new NbtCompound();
        arbitraryData.putString("streetcraft_secret", "must-not-leak");
        stack.set(DataComponentTypes.CUSTOM_DATA, NbtComponent.of(arbitraryData));
        stack.set(DataComponentTypes.LORE, new LoreComponent(List.of(Text.literal("private lore"))));
        stack.set(DataComponentTypes.CONTAINER, ContainerComponent.fromStacks(
                List.of(new ItemStack(Items.NETHERITE_INGOT, 3))
        ));
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(0, stack);

        InventorySerializer.SerializedItemStack serialized = serializer.serialize(
                InventorySerializer.ContainerType.SHULKER_BOX,
                inventory
        ).items().getFirst();

        assertEquals("minecraft:shulker_box", serialized.itemId());
        assertFalse(serialized.toString().contains("must-not-leak"));
        assertFalse(serialized.toString().contains("private lore"));
        assertFalse(serialized.toString().contains("netherite_ingot"));
        assertDtoFieldsAreAllowlisted(InventorySerializer.SerializedInventory.class);
        assertDtoFieldsAreAllowlisted(InventorySerializer.SerializedItemStack.class);
        assertDtoFieldsAreAllowlisted(InventorySerializer.SafeTooltipData.class);
    }

    @Test
    void returnsImmutableListsAndDoesNotMutateTheLiveInventory() {
        ItemStack liveStack = new ItemStack(Items.IRON_PICKAXE, 1);
        liveStack.setDamage(17);
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(8, liveStack);
        ItemStack before = liveStack.copy();

        InventorySerializer.SerializedInventory result = serializer.serialize(
                InventorySerializer.ContainerType.BARREL,
                inventory
        );

        assertThrows(UnsupportedOperationException.class, () -> result.items().clear());
        assertEquals(27, inventory.size());
        assertTrue(ItemStack.areEqual(before, inventory.getStack(8)));
        assertEquals(17, result.items().getFirst().safeTooltipData().damage());
        assertEquals(liveStack.getMaxDamage(), result.items().getFirst().safeTooltipData().maxDamage());
    }

    @Test
    void rejectsAContainerSizeThatDoesNotMatchItsDeclaredType() {
        SimpleInventory wrongSize = new SimpleInventory(26);

        assertThrows(
                IllegalArgumentException.class,
                () -> serializer.serialize(InventorySerializer.ContainerType.CHEST, wrongSize)
        );
    }

    @Test
    void rejectsAStackCountAboveTheVanillaItemsMaximum() {
        ItemStack invalidStack = new ItemStack(Items.DIAMOND);
        invalidStack.setCount(65);
        SimpleInventory inventory = new SimpleInventory(27);
        inventory.setStack(1, invalidStack);
        invalidStack.setCount(65);

        assertThrows(
                IllegalArgumentException.class,
                () -> serializer.serialize(InventorySerializer.ContainerType.CHEST, inventory)
        );
    }

    private static void assertDtoFieldsAreAllowlisted(Class<?> dtoType) {
        List<Class<?>> forbiddenTypes = List.of(
                ItemStack.class,
                Inventory.class,
                NbtCompound.class,
                Map.class
        );

        for (RecordComponent component : dtoType.getRecordComponents()) {
            Class<?> fieldType = component.getType();
            assertFalse(
                    fieldType == Object.class
                            || forbiddenTypes.stream().anyMatch(forbidden -> forbidden.isAssignableFrom(fieldType)),
                    () -> dtoType.getSimpleName() + "." + component.getName() + " exposes " + fieldType
            );
            assertFalse(fieldType.getName().contains("ComponentMap"));
        }

        assertTrue(Arrays.stream(dtoType.getRecordComponents()).allMatch(component -> component.getType() != Object.class));
    }

    private record CountingTextContent(String value, AtomicInteger visitedSegments) implements TextContent {
        @Override
        public <T> Optional<T> visit(StringVisitable.Visitor<T> visitor) {
            visitedSegments.incrementAndGet();
            return visitor.accept(value);
        }

        @Override
        public <T> Optional<T> visit(StringVisitable.StyledVisitor<T> visitor, Style style) {
            visitedSegments.incrementAndGet();
            return visitor.accept(style, value);
        }

        @Override
        public Type<?> getType() {
            return null;
        }
    }
}
