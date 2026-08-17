package com.streetcraft;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class StreetCraftModSmokeTest {
    @Test
    void declaresTheStreetCraftModId() {
        assertEquals("streetcraft", StreetCraftMod.MOD_ID);
    }
}
