# Release Process & GitHub Distribution

## 🚀 Auto-Update System

Your Electron wrapper now includes automatic update functionality via GitHub Releases!

## 📋 How It Works

### Two Types of Updates

**1. Electron Wrapper Updates (Manual Release)**
- Security patches
- OAuth/authentication improvements  
- Splash screen changes
- Performance improvements
- **Requires:** New GitHub Release

**2. Web App Updates (Automatic)**
- Content changes in Next.js app
- UI updates
- Feature additions to web app
- **No action needed** - Users see changes immediately!

### Update Flow

```
App starts → Check GitHub Releases → New version? → Download silently
→ Notify user → User restarts → Updated! ✅
```

---

## 🔧 Setup Instructions

### Step 1: Create GitHub Repository

1. Go to GitHub and create a new repository
2. Name it: `tirona-electron-wrapper`
3. Make it **public** (required for auto-update to work)

### Step 2: Update Configuration Files

**Update `package.json`:**
```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_GITHUB_USERNAME/tirona-electron-wrapper.git"
}
```

**Update `electron-builder.yml`:**
```yaml
publish:
  - provider: github
    owner: YOUR_GITHUB_USERNAME
    repo: tirona-electron-wrapper
```

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

### Step 3: Generate GitHub Token

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Click "Generate new token (classic)"
3. Name it: `Electron Builder`
4. Select scopes:
   - `repo` (all)
   - `write:packages`
5. Copy the token (save it securely!)

### Step 4: Set Environment Variable

**On Windows (PowerShell):**
```powershell
$env:GH_TOKEN="your_github_token_here"
```

**On macOS/Linux:**
```bash
export GH_TOKEN=your_github_token_here
```

---

## 📦 Creating a Release

### Version 1.0.0 (First Release)

**1. Build the application:**
```bash
npm run build
```

**2. Package and publish to GitHub:**
```bash
npm run package:win
```

**3. Create GitHub Release:**
- Go to your GitHub repository
- Click "Releases" → "Create a new release"
- Tag: `v1.0.0`
- Title: `Tirona v1.0.0`
- Description: Initial release features
- Upload files from `release/` folder:
  - `Tirona-1.0.0-portable.exe` (or setup file)
  - `latest.yml` (auto-generated - important!)

**4. Publish the release**

---

## 🔄 Releasing Updates

### When to Release New Version

✅ **Release new version for:**
- Bug fixes in Electron wrapper
- Security updates
- OAuth/Clerk changes
- Splash video updates
- Performance improvements

❌ **Don't release for:**
- Next.js content changes (automatic via Vercel)
- Web app UI updates (automatic via Vercel)
- Database changes (handled by backend)

### Update Process

**1. Update version in `package.json`:**
```json
{
  "version": "1.0.1"
}
```

**2. Build and package:**
```bash
npm run build
npm run package:win
```

**3. The packaged app will:**
- Automatically create a draft release on GitHub
- Upload all necessary files
- Include `latest.yml` for auto-update

**4. Edit the GitHub Release:**
- Add release notes
- Describe what's new
- Publish the release

**5. Users get updates:**
- App checks for updates every 4 hours
- Downloads silently in background
- Notifies user when ready
- Installs on next restart

---

## 🔢 Version Numbering

Use Semantic Versioning: `MAJOR.MINOR.PATCH`

- **1.0.0** → Initial release
- **1.0.1** → Bug fix (wrapper only)
- **1.1.0** → New feature (wrapper only)
- **2.0.0** → Breaking change

**Examples:**
- Fixed OAuth bug → `1.0.1`
- Added new splash screen → `1.1.0`
- Changed app architecture → `2.0.0`

---

## 🧪 Testing Updates

### Test Before Publishing

**1. Create a test release:**
- Tag: `v1.0.1-beta`
- Mark as "Pre-release"

**2. Install v1.0.0 on test machine**

**3. Publish v1.0.1-beta**

**4. Open v1.0.0 app:**
- Should show "Update available" dialog
- Download update
- Restart
- Should be on v1.0.1

**5. If successful, create official v1.0.1 release**

---

## 📝 Release Checklist

Before each release:

- [ ] Update version in `package.json`
- [ ] Test build locally: `npm run build`
- [ ] Test packaged app works
- [ ] Update CHANGELOG.md (if you create one)
- [ ] Set `GH_TOKEN` environment variable
- [ ] Package: `npm run package:win`
- [ ] Verify files in `release/` folder
- [ ] Create GitHub Release
- [ ] Upload all files including `latest.yml`
- [ ] Write clear release notes
- [ ] Publish release
- [ ] Test auto-update from previous version

---

## 🎯 User Experience

**First Install:**
1. User downloads `Tirona-Setup-1.0.0.exe`
2. Installs application
3. App opens with splash video
4. Loads `https://tironabattlemap.vercel.app`

**Auto-Update:**
1. App checks for updates (every 4 hours)
2. New version found
3. Dialog: "Update available - Download?"
4. Downloads in background
5. Dialog: "Update ready - Restart now?"
6. User restarts → Updated!

**Web Updates:**
1. You update Next.js app on Vercel
2. Deploy to production
3. Users open app → See new content immediately!
4. No Electron update needed ✨

---

## 🔐 Security Notes

- **Code signing recommended** for production
- Without signing: Windows shows "Unknown publisher" warning
- With signing: Seamless installation
- GitHub token: Keep secret, never commit to repo
- Store token in environment variable only

---

## 📊 Monitoring Updates

Check GitHub Release analytics:
- Download counts per version
- Which versions users are on
- Update adoption rate

---

## 🆘 Troubleshooting

**Update check fails:**
- Check internet connection
- Verify GitHub token is set
- Ensure repository is public
- Check `latest.yml` exists in release

**Users not getting updates:**
- Verify they're on version with auto-updater
- Check they have v1.0.0+ (not dev build)
- Ensure `latest.yml` is in GitHub Release
- Verify publish config in electron-builder.yml

**Build fails:**
- Clear `release/` folder
- Delete `node_modules` and reinstall
- Check GH_TOKEN is set
- Run `npm run build` first

---

## 🎉 Benefits

✅ **Automatic distribution** - No manual upload needed  
✅ **Seamless updates** - Users always current  
✅ **Professional** - Standard industry practice  
✅ **Free hosting** - GitHub Releases is free  
✅ **Version control** - All releases tracked  
✅ **Web updates automatic** - Most updates need no action!  

---

## 📚 Additional Resources

- [electron-updater docs](https://www.electron.build/auto-update.html)
- [GitHub Releases guide](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [Semantic Versioning](https://semver.org/)

---

**Ready to distribute!** 🚀  
Your app now has professional auto-update capabilities via GitHub Releases.

