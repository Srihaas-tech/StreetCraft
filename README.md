# StreetCraft

StreetCraft is a separate public first-person web experience for BlueMap terrain, with private read-only container inspection planned behind password authentication.

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

## Security boundary

Street View is public. Container contents are not implemented by this bootstrap and must remain authenticated and read-only. Do not store a raw password in the repository or client configuration; later authentication configuration accepts only a password hash.
