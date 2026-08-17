# StreetCraft v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build StreetCraft as a separate web application that provides public first-person BlueMap exploration and private password-protected container inspection.

**Architecture:** StreetCraft consumes BlueMap-rendered terrain instead of rendering raw Minecraft worlds. A small Fabric-side API provides live read-only container data after password authentication.

**Tech Stack:** TypeScript, Vite, Three.js, Node.js or equivalent lightweight HTTP server, Fabric 1.21.1, Java 21, JUnit, Vitest, Playwright.

## Global Constraints

- Minecraft version: 1.21.1.
- Fabric server remains the authoritative source for container inventories.
- BlueMap remains on port 8101.
- StreetCraft uses port 8102.
- Street View is public.
- Container contents require the owner's password.
- Store only a password hash.
- Container APIs are read-only.
- StreetCraft failures must not stop CoreCraft or BlueMap.
- Do not modify BlueMap source code.
- Do not implement a second raw-world renderer in v1.

---

## File Structure

Create:

```text
streetcraft/
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── web/
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.ts
│   │   ├── config.ts
│   │   ├── bluemap/
│   │   │   ├── asset-source.ts
│   │   │   ├── map-loader.ts
│   │   │   └── world-transform.ts
│   │   ├── movement/
│   │   │   ├── camera-controller.ts
│   │   │   ├── collision.ts
│   │   │   └── input.ts
│   │   ├── inspection/
│   │   │   ├── raycast.ts
│   │   │   ├── block-info.ts
│   │   │   └── container-client.ts
│   │   ├── auth/
│   │   │   ├── auth-client.ts
│   │   │   └── session-store.ts
│   │   └── inventory/
│   │       ├── inventory-screen.ts
│   │       ├── item-atlas.ts
│   │       └── tooltip.ts
│   └── tests/
│       ├── movement.test.ts
│       ├── raycast.test.ts
│       ├── auth.test.ts
│       └── inventory.test.ts
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── rate-limit.ts
│   │   └── proxy.ts
│   └── tests/
│       ├── auth.test.ts
│       └── proxy.test.ts
├── fabric-api/
│   ├── build.gradle
│   ├── settings.gradle
│   ├── gradle.properties
│   └── src/
│       ├── main/java/.../StreetCraftMod.java
│       ├── main/java/.../ContainerApi.java
│       ├── main/java/.../ContainerReader.java
│       ├── main/java/.../InventorySerializer.java
│       └── test/java/.../
│           ├── InventorySerializerTest.java
│           └── ContainerReaderTest.java
└── deploy/
    ├── streetcraft.service
    └── streetcraft.env.example
```

Each file must have one primary responsibility.

---

### Task 1: Bootstrap the StreetCraft workspace

**Files:**
- Create the project structure above.
- Create `README.md`.
- Create TypeScript and Vite configuration.
- Create Fabric API Gradle configuration.

**Produces:**
- `npm test`
- `npm run build`
- `./gradlew test`

- [ ] Create the repository structure.
- [ ] Add TypeScript strict mode.
- [ ] Add Vitest.
- [ ] Add Playwright.
- [ ] Add Three.js.
- [ ] Add a minimal Node HTTP server.
- [ ] Configure Fabric 1.21.1 and Java 21.
- [ ] Add one failing smoke test for the web app.
- [ ] Add one failing smoke test for the Fabric module.
- [ ] Run both tests and confirm failure.
- [ ] Implement minimal bootstraps.
- [ ] Run tests and confirm success.
- [ ] Commit with `chore: bootstrap streetcraft workspace`.

---

### Task 2: Load BlueMap assets

**Files:**
- `web/src/bluemap/asset-source.ts`
- `web/src/bluemap/map-loader.ts`
- `web/src/bluemap/world-transform.ts`
- `web/tests/bluemap.test.ts`

**Interfaces:**
- Produce `BlueMapAssetSource`.
- Produce `loadMapMetadata()`.
- Produce world-to-render coordinate transforms.

- [ ] Write tests for BlueMap asset URL construction.
- [ ] Write tests for map metadata parsing.
- [ ] Write tests for coordinate conversion.
- [ ] Confirm tests fail.
- [ ] Implement the minimum asset source.
- [ ] Implement map metadata loading.
- [ ] Implement coordinate conversion.
- [ ] Confirm tests pass.
- [ ] Add a development configuration for BlueMap at `http://127.0.0.1:8101`.
- [ ] Commit with `feat: load bluemap world assets`.

---

### Task 3: Add first-person camera and input

**Files:**
- `web/src/movement/input.ts`
- `web/src/movement/camera-controller.ts`
- `web/tests/movement.test.ts`

**Interfaces:**
- Produce `MovementInput`.
- Produce `CameraController.update(deltaSeconds)`.

- [ ] Write tests for forward, backward, left, and right movement.
- [ ] Write tests for mouse yaw and pitch.
- [ ] Write tests for pitch clamping.
- [ ] Confirm tests fail.
- [ ] Implement keyboard state.
- [ ] Implement pointer-lock mouse look.
- [ ] Implement camera movement.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: add first person controls`.

---

### Task 4: Add gravity, jumping, and collision

**Files:**
- `web/src/movement/collision.ts`
- `web/src/movement/camera-controller.ts`
- `web/tests/movement.test.ts`

**Interfaces:**
- Produce `CollisionWorld`.
- Produce `resolveMovement(position, velocity, bounds)`.

- [ ] Write a test that prevents movement through a solid block.
- [ ] Write a test for standing on a solid surface.
- [ ] Write a test for jump velocity.
- [ ] Write a test for gravity.
- [ ] Confirm tests fail.
- [ ] Implement axis-aligned collision.
- [ ] Implement grounded state.
- [ ] Implement jump.
- [ ] Implement gravity.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: add basic street view physics`.

---

### Task 5: Add block raycasting and public block inspection

**Files:**
- `web/src/inspection/raycast.ts`
- `web/src/inspection/block-info.ts`
- `web/tests/raycast.test.ts`

**Interfaces:**
- Produce `raycastBlock(origin, direction, maxDistance)`.
- Produce `BlockInfo { id, x, y, z, isContainer }`.

- [ ] Write a test for selecting the nearest block.
- [ ] Write a test for no hit.
- [ ] Write a test for container detection.
- [ ] Confirm tests fail.
- [ ] Implement raycasting.
- [ ] Implement the block information panel.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: add block inspection`.

---

### Task 6: Implement password authentication

**Files:**
- `server/src/auth.ts`
- `server/src/rate-limit.ts`
- `server/tests/auth.test.ts`
- `web/src/auth/auth-client.ts`
- `web/src/auth/session-store.ts`

**Interfaces:**
- `POST /api/auth/login`
- `POST /api/auth/logout`
- Short-lived authenticated session.

- [ ] Write a test for a correct password.
- [ ] Write a test for an incorrect password.
- [ ] Write a test for session expiration.
- [ ] Write a test for login rate limiting.
- [ ] Confirm tests fail.
- [ ] Use a standard password-hashing library.
- [ ] Read the password hash from an environment variable or protected file.
- [ ] Create an HTTP-only session cookie when possible.
- [ ] Implement logout.
- [ ] Implement rate limiting.
- [ ] Confirm tests pass.
- [ ] Verify that no raw password is logged.
- [ ] Commit with `feat: add container authentication`.

---

### Task 7: Implement Fabric container reading

**Files:**
- `fabric-api/src/main/java/.../ContainerReader.java`
- `fabric-api/src/main/java/.../InventorySerializer.java`
- `fabric-api/src/test/java/.../ContainerReaderTest.java`
- `fabric-api/src/test/java/.../InventorySerializerTest.java`

**Interfaces:**
- Produce read-only container lookup by dimension and coordinates.
- Serialize safe item data.

Returned item fields:

```text
slot
itemId
count
displayName
safeTooltipData
```

- [ ] Write a test for a 27-slot chest.
- [ ] Write a test for a 54-slot double chest.
- [ ] Write a test for a barrel.
- [ ] Write a test for a shulker box.
- [ ] Write a test for an empty slot.
- [ ] Write a test that excludes arbitrary NBT.
- [ ] Confirm tests fail.
- [ ] Implement container lookup.
- [ ] Implement double-chest combination.
- [ ] Implement safe serialization.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: read live container inventories`.

---

### Task 8: Expose the local Fabric API

**Files:**
- `fabric-api/src/main/java/.../ContainerApi.java`
- `fabric-api/src/main/java/.../StreetCraftMod.java`
- Fabric API tests.

**Interfaces:**
- Local-only inventory endpoint.
- Request includes dimension and block coordinates.

- [ ] Write a test for a valid container request.
- [ ] Write a test for a missing container.
- [ ] Write a test for invalid coordinates.
- [ ] Confirm tests fail.
- [ ] Bind the API to loopback only.
- [ ] Add the container endpoint.
- [ ] Return JSON with safe inventory fields.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: expose local container api`.

---

### Task 9: Add authenticated API proxy

**Files:**
- `server/src/proxy.ts`
- `server/tests/proxy.test.ts`

**Interfaces:**
- `GET /api/container?dimension=...&x=...&y=...&z=...`

- [ ] Write a test that rejects unauthenticated requests.
- [ ] Write a test that forwards authenticated requests.
- [ ] Write a test that does not leak upstream errors.
- [ ] Confirm tests fail.
- [ ] Implement the authenticated proxy.
- [ ] Ensure the browser never connects directly to the Fabric API.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: protect container api`.

---

### Task 10: Build the Minecraft-style inventory screen

**Files:**
- `web/src/inventory/inventory-screen.ts`
- `web/src/inventory/item-atlas.ts`
- `web/src/inventory/tooltip.ts`
- `web/tests/inventory.test.ts`

**Interfaces:**
- Render 27-slot, 54-slot, and shulker layouts.
- Render read-only items.

- [ ] Write layout tests for 27 slots.
- [ ] Write layout tests for 54 slots.
- [ ] Write layout tests for shulker boxes.
- [ ] Write a test for stack counts.
- [ ] Write a test for item names.
- [ ] Write a test for hover tooltips.
- [ ] Confirm tests fail.
- [ ] Implement the inventory frame.
- [ ] Implement the item texture atlas.
- [ ] Implement stack-count rendering.
- [ ] Implement hover tooltips.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: add minecraft inventory viewer`.

---

### Task 11: Integrate container interaction into Street View

**Files:**
- `web/src/app.ts`
- `web/src/inspection/container-client.ts`
- `web/src/auth/auth-client.ts`
- Integration tests.

- [ ] Write a test for clicking a normal block.
- [ ] Write a test for clicking a container while logged out.
- [ ] Write a test for a successful login flow.
- [ ] Write a test for opening a container after login.
- [ ] Confirm tests fail.
- [ ] Add the password prompt.
- [ ] Request container data after authentication.
- [ ] Open the Minecraft-style inventory UI.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: connect street view to container viewer`.

---

### Task 12: Add failure handling

**Files:**
- `web/src/app.ts`
- `web/src/inspection/container-client.ts`
- `server/src/proxy.ts`
- Tests.

- [ ] Test unavailable BlueMap assets.
- [ ] Test unavailable Fabric API.
- [ ] Test expired authentication.
- [ ] Test a removed container.
- [ ] Confirm tests fail.
- [ ] Add clear UI errors.
- [ ] Keep public Street View usable when the container API fails.
- [ ] Confirm tests pass.
- [ ] Commit with `feat: handle streetcraft service failures`.

---

### Task 13: Add browser end-to-end tests

**Files:**
- `web/tests/e2e/street-view.spec.ts`
- `web/tests/e2e/container-auth.spec.ts`

- [ ] Test entering Street View.
- [ ] Test WASD movement.
- [ ] Test pointer lock.
- [ ] Test block selection.
- [ ] Test rejected unauthenticated container access.
- [ ] Test password login.
- [ ] Test Minecraft-style inventory rendering.
- [ ] Run Playwright.
- [ ] Fix all failures.
- [ ] Commit with `test: add streetcraft browser coverage`.

---

### Task 14: Add production service configuration

**Files:**
- `deploy/streetcraft.service`
- `deploy/streetcraft.env.example`
- `README.md`

Service requirements:

```text
Port: 8102
Restart: on-failure
User: pangrusak
StreetCraft path: /home/pangrusak/CoreCraft_SERVER/streetcraft
```

- [ ] Add the systemd unit.
- [ ] Add environment configuration.
- [ ] Document password-hash generation.
- [ ] Document BlueMap URL configuration.
- [ ] Document installation.
- [ ] Document startup and shutdown.
- [ ] Document log inspection.
- [ ] Commit with `docs: add streetcraft deployment`.

---

### Task 15: Final verification

Run:

```text
npm test
npm run build
npx playwright test
./gradlew test
```

Then verify on the Raspberry Pi:

```text
BlueMap:     http://127.0.0.1:8101
StreetCraft: http://127.0.0.1:8102
```

Verify these behaviors:

- [ ] CoreCraft starts without StreetCraft.
- [ ] BlueMap starts without StreetCraft.
- [ ] StreetCraft starts independently.
- [ ] Public users can enter Street View.
- [ ] Public users can inspect block IDs.
- [ ] Public users cannot obtain container contents.
- [ ] Incorrect passwords do not create sessions.
- [ ] Correct password unlocks container viewing.
- [ ] Sessions expire.
- [ ] Chests display correctly.
- [ ] Double chests display correctly.
- [ ] Barrels display correctly.
- [ ] Shulker boxes display correctly.
- [ ] StreetCraft cannot modify inventories.
- [ ] Stopping StreetCraft does not stop `ccpaper`.

Commit final verified state with:

```text
feat: complete streetcraft v1
```
