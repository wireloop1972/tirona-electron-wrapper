# Distribution Guide - Windows Security & Steam

## 🛡️ Windows Security Considerations

When distributing your Electron app with the bundled Chatterbox TTS server, you'll encounter several Windows security features that users will face.

---

## Windows Defender & SmartScreen

### Issue:
- Windows will flag unsigned executables as potentially harmful
- Users will see "Windows protected your PC" warnings
- Antivirus software may quarantine the Python executable

### Solutions:

#### 1. **Code Signing Certificate (REQUIRED for Professional Distribution)**

**Get an EV (Extended Validation) Code Signing Certificate:**
- Cost: $300-500/year
- Providers: DigiCert, Sectigo, GlobalSign
- Benefits:
  - Instant SmartScreen reputation
  - No warnings for users
  - Required for Windows 11
  - Professional trust

**Sign both executables:**
```bash
# Sign the Electron app
signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 "Tirona Setup.exe"

# Sign the TTS server
signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 "chatterbox_server.exe"
```

**electron-builder configuration:**
```json
{
  "win": {
    "certificateFile": "certificate.pfx",
    "certificatePassword": "your-password",
    "signingHashAlgorithms": ["sha256"],
    "sign": "./sign.js"  // Custom signing script
  }
}
```

#### 2. **Build SmartScreen Reputation (Takes Time)**

Even with signing, new certificates need reputation:
- Windows tracks downloads and user interactions
- Takes ~3-6 months and 1000+ downloads
- Users will see warnings initially
- Eventually, warnings disappear

#### 3. **Antivirus Whitelisting**

**Submit to major antivirus vendors:**
- Windows Defender: https://www.microsoft.com/en-us/wdsi/filesubmission
- Norton: https://submit.norton.com
- McAfee: https://www.mcafee.com/enterprise/en-us/threat-center/submit-sample.html
- Avast: https://www.avast.com/false-positive-file-form.php
- AVG: Contact support
- Kaspersky: https://opentip.kaspersky.com

**For PyInstaller executables (Chatterbox):**
- PyInstaller executables are often flagged as false positives
- Add hashes to antivirus databases
- Submit to antivirus vendors for whitelisting

---

## NSIS Installer Configuration

Update your NSIS installer to request appropriate permissions:

```yaml
# electron-builder.yml
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false  # Per-user install (no admin needed)
  createDesktopShortcut: true
  createStartMenuShortcut: true
  deleteAppDataOnUninstall: false
  
  # Add firewall rule request
  include: "installer-scripts/firewall.nsh"
```

**Firewall script (installer-scripts/firewall.nsh):**
```nsh
# Allow the TTS server through Windows Firewall
ExecWait 'netsh advfirewall firewall add rule name="Tirona TTS Server" dir=in action=allow program="$INSTDIR\resources\chatterbox\chatterbox_server.exe" enable=yes'
```

---

## User Experience - First Run

### What Users Will See (Without Code Signing):

1. **During Download:**
   - Browser warning: "This type of file can harm your computer"
   - Recommendation: Add download page with instructions

2. **During Installation:**
   - Windows SmartScreen: "Windows protected your PC"
   - User must click "More info" → "Run anyway"

3. **After Installation:**
   - First run may trigger Windows Defender scan
   - Antivirus may quarantine chatterbox_server.exe
   - User needs to whitelist/allow

### With Code Signing:

1. **Smooth installation** - no warnings
2. **Trusted publisher** shown
3. **Professional appearance**

---

## Steam Distribution

### Requirements for Steam:

#### 1. **Steam Runtime Compatibility**
- Electron apps work on Steam
- No special Steam integration needed for TTS
- Package as standard Windows executable

#### 2. **Steam Depot Configuration**

```
AppId: [Your Steam App ID]
DepotId: [Windows Depot ID]

Builds:
  - Windows x64
    - Tirona.exe (main executable)
    - resources/
      - app.asar
      - chatterbox/
        - chatterbox_server.exe  <-- Include this
    - All DLLs and dependencies
```

#### 3. **Steam SDK Integration (Optional)**

If you want Steam features:
```bash
npm install steamworks.js
```

Then in your Electron app:
```typescript
import { init } from 'steamworks.js';

app.whenReady().then(() => {
  // Initialize Steam
  const steam = init(YOUR_STEAM_APP_ID);
  
  // Your existing code...
  // TTS engine starts on demand via tts-manager.ts
});
```

#### 4. **Steam Achievements (Optional)**

Track TTS usage:
```typescript
steam.achievement.activate('FIRST_TTS_USE');
steam.achievement.activate('100_TTS_GENERATED');
```

### Steam Review Process

**What Valve checks:**
1. ✅ App launches without errors
2. ✅ No external dependencies (we bundle Python ✓)
3. ✅ Firewall rules properly requested
4. ✅ Saves data to appropriate directories (we use AppData ✓)
5. ✅ Clean uninstall (leaves no junk)

**Potential Issues:**
- ⚠️ Antivirus false positives
- ⚠️ First-run delays (model loading)
- ⚠️ Large download size (~150-200MB with TTS binary)

**Solutions:**
- Code sign everything
- Show loading screen during TTS startup
- Explain download size in store page

---

## File Locations (Best Practices)

We're already following best practices:

```
✅ App: C:\Program Files\Tirona\
✅ Models: %APPDATA%\Tirona\chatterbox_models\
✅ Config: %APPDATA%\Tirona\
✅ Temp: %TEMP%\tirona-*\
```

This works on Steam and standalone.

---

## Testing Checklist for Distribution

### Before Release:

- [ ] **Code sign all executables**
  - Main Electron app (.exe)
  - TTS server (chatterbox_server.exe)
  - Installer (.exe)

- [ ] **Test on clean Windows 10 & 11**
  - Fresh install (no dev tools)
  - With Windows Defender active
  - With common antivirus (Norton, McAfee)

- [ ] **Test installer**
  - Per-user install (no admin)
  - Admin install (for all users)
  - Uninstall (clean removal)

- [ ] **Test first run**
  - Model download works
  - Firewall prompt appears
  - TTS server starts
  - No crashes or errors

- [ ] **Submit to antivirus vendors**
  - Get hash whitelisted
  - Monitor false positive reports

- [ ] **Steam preparation** (if applicable)
  - Test on Steam client
  - Verify saves sync properly
  - Test offline mode

---

## User Documentation

### Installation Guide (for users):

**"Getting Started with Tirona"**

1. **Download & Install**
   - Download from [your website] or Steam
   - If Windows shows a warning:
     - Click "More info"
     - Click "Run anyway"
   - This is normal for new apps without SmartScreen reputation

2. **First Run Setup**
   - First launch may take 30-60 seconds
   - Windows Firewall may ask for permission - Click "Allow"
   - Voice models downloading (~6GB, one-time)
   - Progress shown in app

3. **Antivirus Issues**
   - Some antivirus may flag the app as unknown
   - This is a false positive (we're waiting for approval)
   - Add exception for: `C:\Program Files\Tirona\`

---

## Cost Breakdown

### One-Time Costs:
- **EV Code Signing Certificate**: $300-500/year
  - DigiCert: $474/year
  - Sectigo: $315/year
  - GlobalSign: $399/year

### Optional:
- **Steam Direct Fee**: $100 (one-time, per game)
- **Notarization (macOS)**: Free with Apple Developer ($99/year)

### Recommended Minimum:
- **Year 1**: $400-600 (certificate + Steam)
- **Year 2+**: $300-500 (certificate renewal)

---

## Alternatives to Code Signing

If you can't afford code signing initially:

### 1. **Build Reputation Gradually**
- Start with free distribution
- Collect downloads and user reports
- SmartScreen will eventually trust you
- Takes 3-6 months

### 2. **Clear User Communication**
- Add "Installation Guide" to website
- Include screenshots of security warnings
- Explain why they occur
- Build trust through transparency

### 3. **Use Microsoft Store**
- $19 one-time fee
- Microsoft signs your app
- No SmartScreen warnings
- Users trust the Store

---

## Quick Win: Microsoft Store

**Benefits:**
- ✅ Microsoft signs your app (no warnings!)
- ✅ Built-in trust
- ✅ Easy updates
- ✅ Only $19 registration fee
- ✅ Works alongside Steam

**Package for Store:**
```bash
npm install --save-dev electron-windows-store

# Convert to AppX
electron-windows-store --input-directory ./release/win-unpacked --output-directory ./release/store --package-version 1.0.0 --package-name Tirona
```

---

## Summary

### For Professional Release:

1. **Get EV Code Signing Certificate** ($300-500/year)
2. **Sign all executables**
3. **Submit to antivirus vendors**
4. **Package for Steam** ($100 one-time)
5. **Optional: Microsoft Store** ($19 one-time)

### For Budget/Early Access:

1. **Build SmartScreen reputation** (free, takes time)
2. **Clear user documentation** (explain warnings)
3. **Microsoft Store** ($19 - best bang for buck)
4. **Submit hashes to antivirus** (free)

### For Steam:

- ✅ Works with or without code signing
- ✅ Steam doesn't require special configuration
- ✅ Package as normal Windows app
- ✅ Include all dependencies (we do)

---

## Next Steps

1. **Immediate**: Test on clean Windows (VM or friend's PC)
2. **Short-term**: Get Microsoft Store listing ($19)
3. **Long-term**: Get code signing certificate
4. **Before Steam**: Full testing checklist above

Your app is **ready for distribution** - just need to handle security warnings appropriately!

---

**Status**: ✅ Architecture complete, ready for production with proper signing
