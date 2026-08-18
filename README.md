# StreetCraft

StreetCraft is a separate public first-person web experience for BlueMap terrain, with private read-only container inspection behind password authentication.

## Development

StreetCraft requires Node.js `^20.19.0 || >=22.12.0` for Vite 8. Install JavaScript dependencies with `npm install`, then run:

```text
npm test
npm run build
npm run dev
```

The Vite development server listens on port 8102. BlueMap remains independently configured at `http://127.0.0.1:8101`.

Run the Fabric module tests with:

```text
cd fabric-api
./gradlew test
```

The Fabric module targets Minecraft 1.21.1 and Java 21. The local build may run on a newer compatible JDK while compiling Java sources with release 21.

Run Playwright end-to-end tests (requires a running server):

```text
npx playwright test
```

## Architecture

```text
CoreCraft world -> BlueMap renderer -> BlueMap map assets -> StreetCraft web application
                                       |
                                       +-- First-person renderer (WASD, mouse, jump, gravity, collision)
                                       +-- Public block inspection
                                       +-- Container interaction (password-protected)
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| BlueMap | 8101 | Map rendering (independent) |
| StreetCraft | 8102 | Street View web application |
| Fabric API | 8103 (loopback) | Container data from CoreCraft |

## Deployment

### Prerequisites

- Node.js `^20.19.0 || >=22.12.0`
- CoreCraft Fabric server with the StreetCraft mod
- BlueMap running on the same server

### Password Hash Generation

Generate a password hash for container authentication:

```text
node -e "const a=require('@node-rs/argon2');a.hash('your-password').then(h=>console.log(h))"
```

### Environment Configuration

Copy the example environment file and configure:

```text
cp deploy/streetcraft.env.example .env
```

Set `STREETCRAFT_PASSWORD_HASH` to the generated hash.

### Installation

```text
cd /home/pangrusak/CoreCraft_SERVER/streetcraft
npm install --omit=dev
```

### Service Setup

```text
sudo cp deploy/streetcraft.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable streetcraft
sudo systemctl start streetcraft
```

### Startup and Shutdown

```text
sudo systemctl start streetcraft
sudo systemctl stop streetcraft
sudo systemctl restart streetcraft
```

### Log Inspection

```text
sudo journalctl -u streetcraft -f
sudo journalctl -u streetcraft --since "1 hour ago"
```

## Security

- Street View is public. Container contents require authentication.
- Only password hashes are stored. Raw passwords are never logged or stored.
- Container APIs are read-only. No inventory modification is possible.
- Rate limiting protects login attempts.
- Sessions expire after 15 minutes.
- Fabric API binds to loopback only.
- StreetCraft runs as a separate service from CoreCraft.
