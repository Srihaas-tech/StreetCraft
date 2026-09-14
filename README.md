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

Run the Paper plugin tests (targets Paper 1.16.4 and Java 11):

```text
cd paper-api
./gradlew test
```

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
| StreetCraft (Paper) | 8102 | Street View web application (`streetcraft.service`) |
| StreetCraft (Fabric) | 8104 | Street View web application (`ccstreetcraft.service`) |
| Fabric/Paper API | 8103 (loopback) | Container data from the Minecraft server |

The web server also proxies `/bluemap` to BlueMap (port 8101) and serves the built
frontend from `dist/web`, so production runs as a single process with no Vite needed.

## Deployment

### Prerequisites

- Node.js `^20.19.0 || >=22.12.0`
- CoreCraft Fabric or Paper server with the StreetCraft API module
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

Set `STREETCRAFT_PASSWORD_HASH` to the generated hash, and set `STREETCRAFT_PORT`
to the port for this copy (see below).

### Installation

Create one copy of the repository per Minecraft server:

```text
# Paper server
mkdir -p /home/pangrusak/MC_SERVER/streetcraft
cp -r . /home/pangrusak/MC_SERVER/streetcraft   # from the repo root

# CoreCraft Fabric server
mkdir -p /home/pangrusak/CoreCraft_SERVER/streetcraft
cp -r . /home/pangrusak/CoreCraft_SERVER/streetcraft
```

In each copy, install dependencies (dev dependencies are required because the
service builds the frontend with `npm run build` before starting) and copy `.env`:

```text
cd /home/pangrusak/MC_SERVER/streetcraft
npm install
cp deploy/streetcraft.env.example .env
```

Both copies point at the module API on `127.0.0.1:8103` and BlueMap on
`127.0.0.1:8101` by default. Give each copy its own web port in its `.env`:

```text
STREETCRAFT_PORT=8102   # Paper copy
STREETCRAFT_PORT=8104   # CoreCraft/Fabric copy
```

### Paper Plugin (alternative to the Fabric module)

The `paper-api/` directory is a self-contained Paper plugin that exposes the same
loopback API as the Fabric module (port 8103) for Paper 1.16.4 servers running Java 11.
Build and deploy it separately from the web application:

```text
cd paper-api
./gradlew build
```

Copy the produced `build/libs/streetcraft-paper-api-0.1.0.jar` into the Paper server's
`plugins/` directory and restart the server. Configure the port with the same
`STREETCRAFT_FABRIC_API_PORT` environment variable (defaults to 8103). The plugin binds
to `127.0.0.1` only, starts on world load, and stops cleanly on server shutdown.

Difference from the Fabric module: dimensions are resolved by world name and environment
rather than by registry key (Bukkit has no dimension registry), so custom worlds resolve
to the first matching environment. Display names strip legacy formatting codes and use
the damage/glint model available in 1.16.4.

### Service Setup

Install the web application unit for the server you are running. Start only the
unit that matches the Minecraft server that is running (there is one loopback API
port 8103 for both modules):

```text
# Paper backend
sudo cp deploy/streetcraft.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable streetcraft.service
sudo systemctl start streetcraft.service

# CoreCraft/Fabric backend
sudo cp deploy/ccstreetcraft.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ccstreetcraft.service
sudo systemctl start ccstreetcraft.service
```

Each unit runs `npm run build` (frontend into `dist/web`) and then serves both the
frontend and the API from one `node server/src/index.ts` process.

### Startup and Shutdown

```text
sudo systemctl start streetcraft
sudo systemctl stop streetcraft
sudo systemctl restart streetcraft

sudo systemctl start ccstreetcraft
sudo systemctl stop ccstreetcraft
sudo systemctl restart ccstreetcraft
```

### Log Inspection

```text
sudo journalctl -u streetcraft -f
sudo journalctl -u streetcraft --since "1 hour ago"
sudo journalctl -u ccstreetcraft -f
```

## Security

- Street View is public. Container contents require authentication.
- Only password hashes are stored. Raw passwords are never logged or stored.
- Container APIs are read-only. No inventory modification is possible.
- Rate limiting protects login attempts.
- Sessions expire after 15 minutes.
- API modules bind to loopback only.
- StreetCraft runs as a separate service from CoreCraft.
