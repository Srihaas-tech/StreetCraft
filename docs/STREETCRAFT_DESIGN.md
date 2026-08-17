# StreetCraft v1 Design

## Purpose

StreetCraft is a separate web application that adds a Minecraft-like first-person view to the existing CoreCraft BlueMap output.

StreetCraft does not replace BlueMap. BlueMap remains responsible for terrain rendering.

StreetCraft adds:

- Public first-person exploration.
- WASD movement.
- Mouse look.
- Jump and gravity.
- Basic collision.
- Block inspection.
- Password-protected container inspection.
- Minecraft-style inventory screens.

## Approved Scope

StreetCraft v1 uses BlueMap-rendered terrain.

Terrain freshness follows BlueMap updates.

Container contents come directly from the live CoreCraft server.

StreetCraft does not implement a second full Minecraft world renderer.

StreetCraft does not provide general player authentication.

StreetCraft does not expose container contents to public users.

## Deployment Layout

```text
~/CoreCraft_SERVER/
├── corecraft/
├── velocity/
├── limbo/
└── streetcraft/
```

Expected services:

```text
CoreCraft Fabric     127.0.0.1:25568
BlueMap              0.0.0.0:8101
StreetCraft          0.0.0.0:8102
StreetCraft API      loopback-only or embedded behind StreetCraft
```

BlueMap and StreetCraft must run independently.

A StreetCraft failure must not stop Minecraft, Velocity, NanoLimbo, Playit, Simple Voice Chat, or BlueMap.

## System Architecture

```text
CoreCraft world
      |
      v
BlueMap renderer
      |
      v
BlueMap map assets
      |
      v
StreetCraft web application
      |
      +-- First-person renderer
      |     +-- WASD
      |     +-- mouse look
      |     +-- jump
      |     +-- gravity
      |     +-- basic collision
      |     +-- block selection
      |
      +-- Public block inspection
      |
      +-- Container interaction
              |
              +-- unauthenticated -> password prompt
              |
              +-- authenticated -> StreetCraft server API
                                      |
                                      v
                              CoreCraft Fabric API
                                      |
                                      v
                              live container inventory
```

## Public Features

Anyone with the StreetCraft URL can:

- Enter first-person Street View.
- Move with WASD.
- Look with the mouse.
- Jump.
- Walk through BlueMap-rendered terrain.
- Select visible blocks.
- See the block type and coordinates.
- See chests, barrels, and other containers as normal blocks.

Public users must not receive container inventory data.

## Private Container Inspection

Only the owner can inspect container contents.

The owner authenticates with a password.

The password protects container contents only.

Street View itself remains public.

Supported containers for v1:

- Single chest.
- Double chest.
- Barrel.
- Shulker box.

The browser must not receive inventory contents before successful authentication.

## Authentication Design

The server stores only a strong password hash.

The raw password must never be stored in:

- JavaScript files.
- Static configuration sent to browsers.
- BlueMap assets.
- Git history.
- Logs.

Successful authentication creates a short-lived server-side session or signed session token.

The implementation must include:

- Constant-time password verification through a standard password-hashing library.
- Session expiration.
- Logout.
- Rate limiting for login attempts.
- No inventory response before authentication.

The implementation must bind sensitive API endpoints locally or place them behind the StreetCraft application.

## Minecraft-Style Inventory UI

The container screen must visually resemble Minecraft Java Edition.

Required behavior:

- 27-slot chest and barrel layouts.
- 54-slot double-chest layout.
- Shulker-box layout.
- Item textures.
- Stack counts.
- Item names.
- Hover tooltips.

The UI is read-only in v1.

StreetCraft must not allow item movement, insertion, removal, or remote inventory modification.

## Block Inspection

StreetCraft uses raycasting from the first-person camera.

When the user selects a block, show:

- Block identifier.
- World coordinates.
- Container status when applicable.

Container contents remain unavailable until authentication.

## First-Person Movement

StreetCraft v1 uses lightweight Minecraft-like movement.

Required controls:

- WASD movement.
- Mouse look.
- Jump.
- Gravity.
- Basic block collision.

StreetCraft does not need exact Minecraft physics in v1.

The goal is browser exploration, not gameplay simulation.

## Terrain Source

StreetCraft uses BlueMap-rendered output as its visual world source.

BlueMap remains the authoritative terrain-rendering system.

StreetCraft must not duplicate world rendering from raw region files in v1.

This design reduces implementation scope and keeps BlueMap upgrades independent.

## Terrain Freshness

Block and terrain changes appear in StreetCraft after BlueMap updates the affected area.

Container contents are live when requested from the CoreCraft server.

This means container data can be newer than the visible BlueMap terrain.

The UI must tolerate this difference.

## Security Requirements

Container inventory data is private.

StreetCraft must:

- Require authentication for inventory endpoints.
- Return no hidden inventory data to unauthenticated clients.
- Avoid exposing password hashes.
- Avoid exposing raw world files.
- Sanitize item metadata before sending it to the browser.
- Avoid arbitrary NBT exposure.
- Use read-only inventory APIs.
- Rate-limit login attempts.
- Expire authenticated sessions.

Public Street View must not grant server administration privileges.

## Failure Handling

If BlueMap assets are unavailable, StreetCraft shows a clear map-data error.

If the Fabric API is unavailable, public Street View remains usable.

If authentication expires, the next container request requires login again.

If a container changes between selection and API request, StreetCraft displays the latest live contents.

If a container no longer exists, StreetCraft reports that the container is unavailable.

## Testing Strategy

Tests must cover:

- BlueMap asset loading.
- Camera controls.
- Collision behavior.
- Block raycasting.
- Container detection.
- Authentication success.
- Authentication failure.
- Session expiration.
- Login rate limiting.
- Unauthenticated inventory rejection.
- Single chest serialization.
- Double chest serialization.
- Barrel serialization.
- Shulker serialization.
- Item stack counts.
- Item names.
- Tooltip data.
- API unavailable behavior.

Security tests must verify that unauthenticated requests never contain inventory contents.

## Service Isolation

StreetCraft must run separately from `ccpaper`.

Recommended service name:

```text
streetcraft.service
```

Recommended web port:

```text
8102
```

BlueMap remains on:

```text
8101
```

Do not make `ccpaper.service` depend on StreetCraft.

StreetCraft can depend on networking and optionally wait for BlueMap availability.

## Future Work

Not part of v1:

- Live terrain streaming directly from CoreCraft.
- Real-time block updates independent of BlueMap.
- Full Minecraft physics.
- Inventory editing.
- Remote item movement.
- Player login accounts.
- Multiplayer browser avatars.
- Teleport controls.
- Entity inspection.
- Administrative server controls.

A later version can use a hybrid model that fetches live nearby blocks while BlueMap remains the primary terrain source.
