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

python3 << 'PYEOF'
import re

path = "src-tauri/gen/android/app/build.gradle.kts"
with open(path, "r") as f:
    content = f.read()

# 1. Add import - add before plugins if no existing imports
if "import java.io.FileInputStream" not in content:
    if "import " in content:
        lines = content.split("\n")
        last_import_idx = max(i for i, l in enumerate(lines) if l.startswith("import "))
        lines.insert(last_import_idx + 1, "import java.io.FileInputStream")
        content = "\n".join(lines)
    else:
        content = "import java.io.FileInputStream\n\n" + content

# 2. Add signingConfigs before buildTypes
if "signingConfigs" not in content:
    signing_block = """    signingConfigs {
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

"""
    if "    buildTypes {" in content:
        content = content.replace("    buildTypes {", signing_block + "    buildTypes {")
    elif "buildTypes {" in content:
        content = content.replace("buildTypes {", signing_block + "buildTypes {")

# 3. Add signingConfig REFERENCE to release buildType
# Use specific pattern to distinguish from "signingConfigs" declaration
if "signingConfig = signingConfigs" not in content:
    content = re.sub(
        r'(getByName\("release"\)\s*\{)',
        r'\1\n                signingConfig = signingConfigs.getByName("release")',
        content,
        count=1
    )

with open(path, "w") as f:
    f.write(content)

print(content)

# Verify
assert "import java.io.FileInputStream" in content, "import missing"
assert "signingConfigs" in content, "signingConfigs block missing"
assert "signingConfig = signingConfigs.getByName" in content, "signingConfig reference missing"
print("\n=== ALL CHECKS PASSED ===")
PYEOF
