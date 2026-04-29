# App Icon Instructions

The Android app requires launcher icons in multiple resolutions.

## Required Icon Files

Place PNG icon files in these directories:

- `app/src/main/res/mipmap-mdpi/ic_launcher.png` (48x48 px)
- `app/src/main/res/mipmap-hdpi/ic_launcher.png` (72x72 px)
- `app/src/main/res/mipmap-xhdpi/ic_launcher.png` (96x96 px)
- `app/src/main/res/mipmap-xxhdpi/ic_launcher.png` (144x144 px)
- `app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` (192x192 px)

## Design Guidelines

**Recommended design:**
- Red background (#DC143C - Scarlet Red)
- White "ST" text or shield icon
- Simple, high contrast design
- Square with rounded corners (Android system applies)

## Creating Icons

### Option 1: Android Studio Image Asset Studio (Easiest)

1. Open project in Android Studio
2. Right-click `res` folder → New → Image Asset
3. Icon Type: Launcher Icons
4. Path: Select your source image (512x512 px recommended)
5. Name: ic_launcher
6. Click Next → Finish
7. Android Studio generates all sizes automatically

### Option 2: Online Icon Generator

1. Visit https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html
2. Upload source image or use text/clipart
3. Configure colors (Background: #DC143C, Foreground: white)
4. Download ZIP
5. Extract and copy mipmap folders to `app/src/main/res/`

### Option 3: Manual Design

1. Create 512x512 px master icon in design tool
2. Export to required sizes:
   - 48x48 (mdpi)
   - 72x72 (hdpi)
   - 96x96 (xhdpi)
   - 144x144 (xxhdpi)
   - 192x192 (xxxhdpi)
3. Name all files `ic_launcher.png`
4. Place in respective mipmap directories

## Temporary Placeholder

The app will build without custom icons (uses Android default green icon).
For production release, replace with Scarlet Technical branded icons.

## File Format

- Format: PNG
- Color mode: RGB or RGBA (transparency supported)
- Bit depth: 24-bit or 32-bit

## Testing

After adding icons:
1. Clean build: `./gradlew clean`
2. Rebuild: `./gradlew assembleDebug`
3. Install and verify icon appears correctly on device
