#!/bin/bash
set -e

BUILD_GRADLE="src-tauri/gen/android/app/build.gradle.kts"

if [ ! -f "$BUILD_GRADLE" ]; then
  echo "build.gradle.kts not found at $BUILD_GRADLE"
  exit 1
fi

# Add import if not present
if ! grep -q "import java.io.FileInputStream" "$BUILD_GRADLE"; then
  sed -i '1s/^/import java.io.FileInputStream\n/' "$BUILD_GRADLE"
fi

# Add signingConfigs before buildTypes if not present
if ! grep -q "signingConfigs" "$BUILD_GRADLE"; then
  sed -i '/^buildTypes {/i\
signingConfigs {\
    create("release") {\
        val keystorePropertiesFile = rootProject.file("keystore.properties")\
        val keystoreProperties = Properties()\
        if (keystorePropertiesFile.exists()) {\
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))\
        }\
        keyAlias = keystoreProperties["keyAlias"] as String\
        keyPassword = keystoreProperties["password"] as String\
        storeFile = file(keystoreProperties["storeFile"] as String)\
        storePassword = keystoreProperties["password"] as String\
    }\
}' "$BUILD_GRADLE"
fi

# Add signingConfig to release buildType if not present
if ! grep -q "signingConfig" "$BUILD_GRADLE"; then
  python3 -c "
import re
with open('$BUILD_GRADLE', 'r') as f:
    content = f.read()

pattern = r'(getByName\(\"release\"\)\s*\{)'
replacement = r'\1\n                signingConfig = signingConfigs.getByName(\"release\")'
content = re.sub(pattern, replacement, content)

with open('$BUILD_GRADLE', 'w') as f:
    f.write(content)
"
fi

echo "=== Patched build.gradle.kts ==="
cat "$BUILD_GRADLE"
