# Application Icons

Place your application icons in this directory:

## Required Files

- **icon.ico** - Windows icon (256x256 pixels recommended)
- **icon.icns** - macOS icon (1024x1024 pixels recommended)

## Creating Icons

You can use these tools to generate icons from a source image:

1. **electron-icon-builder**
   ```bash
   npm install -g electron-icon-builder
   electron-icon-builder --input=./source-icon.png --output=./assets
   ```

2. **icon-gen**
   ```bash
   npm install -g icon-gen
   icon-gen -i source-icon.png -o ./assets
   ```

3. **Online Tools**
   - [iConvert Icons](https://iconverticons.com/online/)
   - [CloudConvert](https://cloudconvert.com/)

## Icon Guidelines

- Use a simple, recognizable design
- Ensure it looks good at small sizes (16x16, 32x32)
- Use transparent backgrounds where appropriate
- Test on both light and dark system themes

