#!/usr/bin/env python3
"""
Patch build.gradle.kts to add Android release signing config.
Handles the Tauri-generated structure by finding the android{} block
and inserting signingConfigs before buildTypes.
"""
import re
import sys
import os

BUILD_GRADLE = "src-tauri/gen/android/app/build.gradle.kts"

if not os.path.exists(BUILD_GRADLE):
    print(f"ERROR: {BUILD_GRADLE} not found")
    sys.exit(1)

with open(BUILD_GRADLE, "r") as f:
    content = f.read()

print("=== Original build.gradle.kts ===")
print(content)
print()

# 1. Add import if not present
if "import java.io.FileInputStream" not in content:
    content = "import java.io.FileInputStream\n" + content

# 2. Add signingConfigs block before buildTypes if not present
if "signingConfigs" not in content:
    signing_block = """signingConfigs {
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
    # Find buildTypes and insert signingConfigs before it
    # This works whether buildTypes is inside android{} or at top level
    if "    buildTypes {" in content:
        content = content.replace("    buildTypes {", "    " + signing_block + "    buildTypes {")
    elif "buildTypes {" in content:
        content = content.replace("buildTypes {", signing_block + "buildTypes {")
    else:
        print("WARNING: buildTypes block not found, appending signingConfigs at end")
        content = content.rstrip() + "\n\n" + signing_block

# 3. Add signingConfig to release buildType if not present
if "signingConfig" not in content:
    # Match the release block inside buildTypes and add signingConfig
    pattern = r'(getByName\("release"\)\s*\{)'
    replacement = r'\1\n                signingConfig = signingConfigs.getByName("release")'
    new_content = re.sub(pattern, replacement, content)
    if new_content != content:
        content = new_content
    else:
        print("WARNING: Could not find release buildType block to add signingConfig")

with open(BUILD_GRADLE, "w") as f:
    f.write(content)

print("=== Patched build.gradle.kts ===")
print(content)
print()

# Verify
has_signing_configs = "signingConfigs" in content
has_signing_config = "signingConfig" in content
if has_signing_configs and has_signing_config:
    print("SUCCESS: Signing config applied")
else:
    print(f"PARTIAL: signingConfigs={has_signing_configs}, signingConfig={has_signing_config}")
    if not has_signing_config:
        print("The release buildType block may have a different structure. Manual fix needed.")
