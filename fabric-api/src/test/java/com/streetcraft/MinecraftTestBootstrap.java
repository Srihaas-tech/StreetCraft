package com.streetcraft;

import net.minecraft.Bootstrap;
import net.minecraft.SharedConstants;

final class MinecraftTestBootstrap {
    private static boolean initialized;

    private MinecraftTestBootstrap() {
    }

    static synchronized void initialize() {
        if (!initialized) {
            SharedConstants.createGameVersion();
            Bootstrap.initialize();
            initialized = true;
        }
    }
}
