#\!/bin/bash
# Verification script for Scarlet Technical Android Agent project

echo "=========================================="
echo "Scarlet Technical Android Agent"
echo "Project Verification Script"
echo "=========================================="
echo ""

ERRORS=0
WARNINGS=0

# Check Java source files
echo "Checking Java source files..."
JAVA_FILES=(
    "app/src/main/java/com/scarlet/agent/MainActivity.java"
    "app/src/main/java/com/scarlet/agent/ScarletDeviceAdminReceiver.java"
    "app/src/main/java/com/scarlet/agent/AgentPollService.java"
    "app/src/main/java/com/scarlet/agent/LockActivity.java"
    "app/src/main/java/com/scarlet/agent/ApiClient.java"
    "app/src/main/java/com/scarlet/agent/BootReceiver.java"
)

for file in "${JAVA_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ✗ MISSING: $file"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check XML files
echo ""
echo "Checking XML resource files..."
XML_FILES=(
    "app/src/main/AndroidManifest.xml"
    "app/src/main/res/layout/activity_main.xml"
    "app/src/main/res/layout/activity_lock.xml"
    "app/src/main/res/values/strings.xml"
    "app/src/main/res/values/colors.xml"
    "app/src/main/res/xml/device_admin.xml"
)

for file in "${XML_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ✗ MISSING: $file"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check build files
echo ""
echo "Checking build configuration..."
BUILD_FILES=(
    "build.gradle"
    "settings.gradle"
    "gradle.properties"
    "app/build.gradle"
    "app/proguard-rules.pro"
)

for file in "${BUILD_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ✗ MISSING: $file"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check documentation
echo ""
echo "Checking documentation files..."
DOC_FILES=(
    "README.md"
    "BUILD.md"
    "TECHNICIAN_GUIDE.md"
    "DEPLOYMENT_CHECKLIST.md"
    "ICON_INSTRUCTIONS.md"
    "PROJECT_STRUCTURE.md"
    "FILE_MANIFEST.md"
    "PROJECT_COMPLETE.md"
)

for file in "${DOC_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file"
    else
        echo "  ✗ MISSING: $file"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check for local.properties
echo ""
echo "Checking optional files..."
if [ -f "local.properties" ]; then
    echo "  ✓ local.properties (configured)"
else
    echo "  ⚠ local.properties (not configured - copy from template)"
    WARNINGS=$((WARNINGS + 1))
fi

# Check for app icons
echo ""
echo "Checking app icons..."
ICON_DIRS=(
    "app/src/main/res/mipmap-mdpi"
    "app/src/main/res/mipmap-hdpi"
    "app/src/main/res/mipmap-xhdpi"
    "app/src/main/res/mipmap-xxhdpi"
    "app/src/main/res/mipmap-xxxhdpi"
)

ICONS_MISSING=0
for dir in "${ICON_DIRS[@]}"; do
    if [ \! -f "$dir/ic_launcher.png" ]; then
        ICONS_MISSING=$((ICONS_MISSING + 1))
    fi
done

if [ $ICONS_MISSING -eq 0 ]; then
    echo "  ✓ All launcher icons present"
else
    echo "  ⚠ $ICONS_MISSING icon density missing (see ICON_INSTRUCTIONS.md)"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo "Errors: $ERRORS"
echo "Warnings: $WARNINGS"
echo ""

if [ $ERRORS -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo "✓ PROJECT COMPLETE - Ready to build\!"
    else
        echo "⚠ PROJECT READY - $WARNINGS warnings (optional)"
        echo ""
        echo "Next steps:"
        [ \! -f "local.properties" ] && echo "  1. Create local.properties with SDK path"
        [ $ICONS_MISSING -gt 0 ] && echo "  2. Add app icons (see ICON_INSTRUCTIONS.md)"
        echo "  3. Build: ./gradlew assembleDebug"
    fi
    exit 0
else
    echo "✗ PROJECT INCOMPLETE - $ERRORS critical files missing"
    exit 1
fi
