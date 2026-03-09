# Tirona Rebirth -- Steam Build & Upload Guide

Reference for building, packaging, and uploading to Steam.

---

## Quick Reference

| Item | Value |
|---|---|
| App ID | **4503860** |
| Code Depot | **4503861** "Tirona Rebirth Content" |
| Assets Depot | **4503862** "Tirona Rebirth Assets" |
| TTS Depot | **4503863** "Tirona Rebirth TTS" |
| Steam Username | `wireloopas` |
| Steamworks SDK | `C:\SteamworksSDK\sdk\tools\ContentBuilder` |
| Build Output | `release\win-unpacked\` |
| Steamworks Portal | https://partner.steamgames.com |

---

## 1. Build Pipeline (step by step)

### 1a. Type-check and compile

```powershell
npm run build
```

This runs `tsc`. Fix any TypeScript errors before proceeding. Common things
to watch for:

- Unused variables/imports (`noUnusedLocals` is enabled)
- Missing types on new IPC handlers
- Incorrect paths after moving files

### 1b. Package with electron-builder

```powershell
npx electron-builder --win --dir
```

This creates `release\win-unpacked\` with the full app. Verify:

- Configuration loaded from `electron-builder.yml` (not `package.json`)
- `config.json` is **inside** the ASAR (not as an extraFile)

```powershell
npx asar list release\win-unpacked\resources\app.asar | findstr config.json
# Should output: \config.json
```

### 1c. (Optional) Download fresh asset pack

Only needed if assets have been added/changed on Vercel since the last build:

```powershell
npm run download:assets
```

Then re-run electron-builder so the new asset-pack is included.

### 1d. One-command build

```powershell
npm run package:steam
```

This runs `tsc` + `download:assets` + `electron-builder --win --dir` in
sequence.

---

## 2. Prepare and Upload to Steam

### 2a. Prepare only (inspect before uploading)

```powershell
.\scripts\prepare-steam-upload.ps1 `
  -SdkPath "C:\SteamworksSDK\sdk\tools\ContentBuilder"
```

This copies `release\win-unpacked\` into the ContentBuilder folder structure,
splitting it into three depot folders. Review the sizes in the output.

### 2b. Prepare and upload in one step

```powershell
.\scripts\prepare-steam-upload.ps1 `
  -SdkPath "C:\SteamworksSDK\sdk\tools\ContentBuilder" `
  -Upload -SteamUser wireloopas
```

### 2c. Set the build live

1. Go to **Steamworks > SteamPipe > Builds** for App 4503860
2. Find the new BuildID in the list
3. Click the branch dropdown next to it and select **default**
4. Click **Set Build Live**
5. Go to **Publish** tab and publish the changes

Steam clients auto-update within minutes.

---

## 3. Depot Architecture

The install is split into three depots so code patches don't force re-download
of multi-gigabyte assets or the TTS server.

```
Steam Install Directory/
├── Tirona.exe                          ─┐
├── *.dll (Electron/Chromium)            │ Depot 4503861 (Code)
├── resources/                           │ ~320 MB
│   ├── app.asar                         │
│   ├── app.asar.unpacked/              ─┘
│   ├── asset-pack/                     ─┐ Depot 4503862 (Assets)
│   │   ├── manifest.json                │ ~1.5 GB
│   │   └── *.glb, *.hdr                ─┘
│   └── tts-server/                     ─┐ Depot 4503863 (TTS)
│       ├── python/                      │ ~5.4 GB
│       ├── server.py                    │
│       └── voices/                     ─┘
```

### When to update each depot

| Scenario | Depots to update |
|---|---|
| JS/TS code change, bug fix, UI tweak | Code only (4503861) |
| New GLB models or HDRI added | Assets only (4503862) |
| TTS server update, new voices | TTS only (4503863) |
| Electron version upgrade | Code (4503861) |
| Everything | All three |

The prepare script always copies all three, but Steam's delta patching means
only changed chunks are downloaded by players. Keeping depot boundaries stable
is key -- don't move files between depots.

---

## 4. When to Create New Depots

Steam best practices:

- **Do** create a new depot when adding a new category of large content that
  updates on a different cadence (e.g., a future "Music Pack" or "Cutscenes"
  depot).
- **Do not** create a depot per file or per asset. Depots are coarse-grained
  containers. A handful is ideal.
- **Do not** reshuffle files between existing depots. This breaks Steam's
  delta patching and forces full re-downloads of both depots.

To add a new depot:

1. **Steamworks**: Go to **Installation > Depots > Add New Depot**
2. Set: Language=All, DLC=Base App, OS=Windows, Arch=64-bit, Platform=All
3. Go to each package under **Application > Packages & DLC** and click
   **Add/Remove Depots** to include the new depot in all three packages
   (Developer Comp, Beta Testing, Store)
4. **Publish** the changes
5. Create a new `steam/depot_NEWID.vdf` file
6. Add the depot to `steam/app_build.vdf`
7. Update `scripts/prepare-steam-upload.ps1` to copy files into the new
   content folder

---

## 5. Steamworks Configuration Reference

### Launch Options

Set in **Installation > General Installation**:

| Field | Value |
|---|---|
| Executable | `Tirona.exe` |
| Launch Type | Launch (Default) |
| OS | Windows |
| CPU Architecture | 64-bit |

### Depots Configuration

Set in **Installation > Depots**. All three depots should have:

| Field | Value |
|---|---|
| Language | All Languages |
| For DLC | Base App |
| Operating System | Windows |
| Architecture | **64-bit OS Only** |
| Platform | All |

### Packages

All three depots must be included in all three packages:

- **Tirona Rebirth Developer Comp** (1571237) -- auto-granted to publisher
- **Tirona Rebirth for Beta Testing** (1571238)
- **Tirona Rebirth** (1571239) -- the store package

Check via **Application > Packages & DLC**, click each package, then
**Add/Remove Depots**.

---

## 6. Local Files Reference

```
electronwrapper/
├── steam/                        # VDF build scripts
│   ├── app_build.vdf             # Top-level build script (references all depots)
│   ├── depot_code.vdf            # Depot 4503861
│   ├── depot_content.vdf         # Depot 4503862
│   └── depot_tts.vdf             # Depot 4503863
├── scripts/
│   ├── prepare-steam-upload.ps1  # Copies build output -> ContentBuilder, uploads
│   ├── download-asset-pack.ts    # Downloads assets from Vercel for bundling
│   └── setup-tts-server.ps1     # Sets up the TTS Python environment
├── electron-builder.yml          # Packaging config (single source of truth)
├── config.json                   # App URLs (must be inside ASAR, not extraFiles)
├── release/
│   └── win-unpacked/             # electron-builder output (what gets uploaded)
├── asset-pack/                   # Downloaded assets (gitignored)
└── tts-server/                   # Bundled Python + Chatterbox (gitignored)
```

---

## 7. Steamworks SDK Setup (first-time only)

1. Download the SDK from https://partner.steamgames.com (look for "Download
   SDK" under your account)
2. Unzip to `C:\SteamworksSDK\`
3. Bootstrap steamcmd:

```powershell
cd C:\SteamworksSDK\sdk\tools\ContentBuilder\builder
.\steamcmd.exe +login wireloopas
# Enter password and Steam Guard code when prompted
# Type: quit
```

Credentials are cached after the first login. Subsequent uploads use cached
credentials automatically.

If credentials expire (usually after ~30 days or a password change), re-run
the login command.

---

## 8. Testing a Build Before Uploading

### Run the packaged exe locally

```powershell
.\release\win-unpacked\Tirona.exe
```

This runs outside Steam, so `isSteamBuild()` returns false. The auto-updater
will try to run (and fail harmlessly). To simulate a Steam environment, create
a `steam_appid.txt` in the exe directory:

```powershell
echo 4503860 > release\win-unpacked\steam_appid.txt
```

Delete it when done testing.

### Verify ASAR contents

```powershell
npx asar list release\win-unpacked\resources\app.asar
```

Key files that must be present:

- `\config.json`
- `\dist\main.js`
- `\src\splash.html`
- `\assets\TironaFading.mp4`
- `\assets\icon.ico`

### Use Steam beta branches for team testing

Instead of setting builds live on `default`, use a beta branch:

1. In **SteamPipe > Builds**, set the new build live on a branch named
   `internal` or `beta`
2. In the Steam client, right-click the game > Properties > Betas > select
   the branch
3. Only set to `default` when ready for all users

---

## 9. Troubleshooting

### White page / app doesn't load

- `config.json` missing from ASAR. Check `electron-builder.yml` -- it must
  be in `files:` and NOT in `extraFiles:`
- Verify: `npx asar list ... | findstr config.json`

### "Failed to check for updates" dialog

- `isSteamBuild()` not detecting Steam. Steam sets `SteamAppId` env var
  when launching. If running the exe directly, this env var is absent.
- Only appears in non-Steam packaged builds (by design -- the auto-updater
  requires a `publish` config which is disabled for Steam).

### TTS Engine Error on close

- Normal when force-killing the server. The `shuttingDown` flag in
  `tts-manager.ts` suppresses this during intentional shutdown.

### steamcmd login fails

- Re-run `steamcmd.exe +login wireloopas` interactively
- Check email for a new Steam Guard code

### Build uploads but depot shows 0 bytes

- Check `ContentRoot` paths in the VDF files
- Verify the content folders exist under `ContentBuilder/content/`
- Check `ContentBuilder/output/` for error logs

### Steam client doesn't update the game

- Verify the build was set live on the correct branch
- Verify the Steamworks changes were **published** (Publish tab)
- Restart Steam or go to the game > Properties > Updates > verify

---

## 10. Typical Update Workflow (cheat sheet)

**Code-only fix:**

```powershell
# 1. Make code changes
# 2. Build and check types
npm run build

# 3. Package
npx electron-builder --win --dir

# 4. Upload
.\scripts\prepare-steam-upload.ps1 `
  -SdkPath "C:\SteamworksSDK\sdk\tools\ContentBuilder" `
  -Upload -SteamUser wireloopas

# 5. Set live in Steamworks > SteamPipe > Builds
# 6. Publish changes
```

Only depot 4503861 will have meaningful upload size (~1-2 MB delta). The
asset and TTS depots upload in seconds because nothing changed.
