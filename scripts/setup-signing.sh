#!/bin/bash
# Patch build.gradle.kts for Android signing
# Based on: https://v2.tauri.app/distribute/sign/android/
set -e

BUILD_GRADLE="src-tauri/gen/android/app/build.gradle.kts"

if [ ! -f "$BUILD_GRADLE" ]; then
  echo "ERROR: $BUILD_GRADLE not found"
  exit 1
fi

echo "=== Original build.gradle.kts ==="
cat "$BUILD_GRADLE"
echo ""

# 1. Add import if not present
if ! grep -q "import java.io.FileInputStream" "$BUILD_GRADLE"; then
  sed -i '1s/^/import java.io.FileInputStream\n/' "$BUILD_GRADLE"
  echo "Added FileInputStream import"
fi

# 2. Add signingConfigs before buildTypes if not present
if ! grep -q "signingConfigs" "$BUILD_GRADLE"; then
  # Use Python for reliable insertion between signingConfigs and buildTypes
  python3 << 'PYEOF'
import re

with open("src-tauri/gen/android/app/build.gradle.kts", "r") as f:
    content = f.read()

signing = '''signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }

'''

# Find the last occurrence of buildTypes (the one inside android{})
# and insert signingConfigs before it
parts = content.split("    buildTypes {")
if len(parts) > 1:
    content = parts[0] + "    " + signing + "    buildTypes {" + parts[1]
else:
    # Fallback: insert before any buildTypes
    content = content.replace("buildTypes {", signing + "buildTypes {")

with open("src-tauri/gen/android/app/build.gradle.kts", "w") as f:
    f.write(content)

print("Inserted signingConfigs block")
PYEOF
fi

# 3. Add signingConfig to release buildType if not present
if ! grep -q "signingConfig" "$BUILD_GRADLE"; then
  python3 << 'PYEOF'
import re

with open("src-tauri/gen/android/app/build.gradle.kts", "r") as f:
    content = f.read()

# Add signingConfig inside the release buildType block
content = re.sub(
    r'(getByName\("release"\)\s*\{)',
    r'\1\n                signingConfig = signingConfigs.getByName("release")',
    content,
    count=1
)

with open("src-tauri/gen/android/app/build.gradle.kts", "w") as f:
    f.write(content)

print("Added signingConfig to release buildType")
PYEOF
fi

echo "=== Patched build.gradle.kts ==="
cat "$BUILD_GRADLE"
echo ""

# Verify
if grep -q "signingConfigs" "$BUILD_GRADLE" && grep -q "signingConfig" "$BUILD_GRADLE"; then
  echo "SUCCESS: Signing config applied"
else
  echo "FAILED: Signing config not properly applied"
  exit 1
fi
