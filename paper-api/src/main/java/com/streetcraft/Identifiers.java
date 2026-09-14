package com.streetcraft;

import java.util.regex.Pattern;

/** Mirrors Minecraft's resource identifier rules used by the web layer's parser. */
final class Identifiers {
    private static final Pattern VALID_IDENTIFIER =
            Pattern.compile("^[a-z0-9_.-]+:[a-z0-9/._-]+$");

    private Identifiers() {
    }

    static boolean isValid(String identifier) {
        return identifier != null && VALID_IDENTIFIER.matcher(identifier).matches();
    }

    static String path(String identifier) {
        return identifier.substring(identifier.indexOf(':') + 1);
    }
}