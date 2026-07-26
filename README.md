# Hermes Mobile (Tauri)

Mobile-first AI assistant built with **Tauri v2 + Vue 3 + TypeScript**.

## Stack

- **Tauri v2** — Rust backend, native mobile runtime
- **Vue 3** — Composition API + TypeScript
- **@tauri-apps/plugin-store** — Persistent key-value storage
- **Vite** — Fast frontend dev/build

## Prerequisites

- Node.js (LTS)
- Rust (stable)
- Android SDK (API 34+)
- Android NDK (27.2+)
- Java JDK 17

## Development

```bash
# Install dependencies
npm install

# Android dev (requires connected device/emulator)
npm run android:dev

# Build APK
npm run android:build
```

## Environment Setup

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
```

## Auto Release

Push a version tag to trigger a CI build:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Actions workflow will build the APK and create a draft release.

## License

MIT
