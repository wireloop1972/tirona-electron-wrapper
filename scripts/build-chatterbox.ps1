<#
.SYNOPSIS
    Build Chatterbox TTS server as a standalone Windows executable.

.DESCRIPTION
    This script clones/updates the chatterbox-tts-api repository, creates the
    entry script, and builds a PyInstaller executable for bundling with Electron.

.PARAMETER RepoPath
    Path where chatterbox-tts-api repo will be cloned. Default: ../chatterbox-tts-api

.PARAMETER OutputPath
    Path where the built executable will be copied. Default: tts-binaries/chatterbox_server

.PARAMETER SkipClone
    Skip cloning/updating the repository (use existing local copy)

.EXAMPLE
    .\scripts\build-chatterbox.ps1

.EXAMPLE
    .\scripts\build-chatterbox.ps1 -RepoPath "C:\dev\chatterbox-tts-api" -SkipClone
#>

param(
    [string]$RepoPath = "..\chatterbox-tts-api",
    [string]$OutputPath = "tts-binaries\chatterbox_server",
    [string]$PythonVersion = "3.11",
    [switch]$SkipClone
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

# Get absolute paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$RepoFullPath = if ([System.IO.Path]::IsPathRooted($RepoPath)) { $RepoPath } else { Join-Path $RootDir $RepoPath }
$OutputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $RootDir $OutputPath }

Write-Host "============================================" -ForegroundColor Magenta
Write-Host " Chatterbox TTS Server Build Script" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "Repository path: $RepoFullPath"
Write-Host "Output path:     $OutputFullPath"
Write-Host ""

# Step 1: Clone or update repository
if (-not $SkipClone) {
    Write-Step "Cloning/updating chatterbox-tts-api repository..."
    
    if (Test-Path $RepoFullPath) {
        Write-Host "Repository exists, pulling latest changes..."
        Push-Location $RepoFullPath
        try {
            git pull origin main
            Write-Success "Repository updated"
        } catch {
            Write-Warn "Could not pull latest changes: $_"
        }
        Pop-Location
    } else {
        Write-Host "Cloning repository..."
        git clone https://github.com/travisvn/chatterbox-tts-api $RepoFullPath
        Write-Success "Repository cloned"
    }
} else {
    Write-Step "Skipping clone (using existing repository)"
    if (-not (Test-Path $RepoFullPath)) {
        Write-Err "Repository not found at $RepoFullPath"
        exit 1
    }
}

# Step 2: Navigate to repo
Push-Location $RepoFullPath

try {
    # Step 3: Install dependencies
    Write-Step "Installing Python dependencies (using Python $PythonVersion)..."
    
    # Check if venv exists and is correct version, recreate if needed
    $RecreateVenv = $false
    if (Test-Path "venv") {
        # Check Python version in existing venv
        $VenvPython = ".\venv\Scripts\python.exe"
        if (Test-Path $VenvPython) {
            $CurrentVersion = & $VenvPython --version 2>&1
            if ($CurrentVersion -notmatch $PythonVersion) {
                Write-Warn "Existing venv uses $CurrentVersion, need Python $PythonVersion"
                Write-Host "Removing incompatible venv..."
                Remove-Item -Recurse -Force "venv"
                $RecreateVenv = $true
            }
        } else {
            $RecreateVenv = $true
        }
    } else {
        $RecreateVenv = $true
    }
    
    if ($RecreateVenv) {
        Write-Host "Creating virtual environment with Python $PythonVersion..."
        # Use py launcher to select specific Python version
        & py -$PythonVersion -m venv venv
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Failed to create venv with Python $PythonVersion"
            Write-Host "Available Python versions:"
            & py --list
            exit 1
        }
    }
    
    # Activate venv
    $VenvActivate = ".\venv\Scripts\Activate.ps1"
    if (Test-Path $VenvActivate) {
        & $VenvActivate
    }
    
    # Verify Python version
    $ActualVersion = & python --version
    Write-Host "Using: $ActualVersion"
    
    # Install requirements
    Write-Host "Installing requirements.txt..."
    pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to install requirements"
        exit 1
    }
    
    Write-Host "Installing PyInstaller..."
    pip install pyinstaller
    Write-Success "Dependencies installed"

    # Step 4: Create entry script
    Write-Step "Creating entry script..."
    
    $EntryScript = @'
#!/usr/bin/env python3
"""
Chatterbox TTS API Server Entry Point
Designed for PyInstaller bundling with Electron wrapper.

Expected behavior:
- Listen on 127.0.0.1:4123 (configurable via --port)
- Expose GET /health for liveness checks
- Expose POST /v1/audio/speech (OpenAI-compatible)
"""

import os
import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description='Chatterbox TTS Server')
    parser.add_argument('--port', type=int, default=4123, help='Port to listen on (default: 4123)')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to (default: 127.0.0.1)')
    args = parser.parse_args()

    # Set environment variables before importing app
    os.environ['CHBTTS_API_PORT'] = str(args.port)
    os.environ['CHBTTS_API_HOST'] = args.host

    print(f"Starting Chatterbox TTS Server on {args.host}:{args.port}...")

    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
    )

if __name__ == "__main__":
    main()
'@
    
    Set-Content -Path "start_chatterbox_api.py" -Value $EntryScript -Encoding UTF8
    Write-Success "Entry script created"

    # Step 5: Build with PyInstaller
    Write-Step "Building executable with PyInstaller..."
    
    # Clean previous build
    if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }
    if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
    
    # Build command - you may need to adjust hidden imports based on actual dependencies
    $PyInstallerArgs = @(
        "--onefile",
        "--name", "chatterbox_server",
        "--add-data", "app;app",
        "--hidden-import", "uvicorn",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--hidden-import", "fastapi",
        "--hidden-import", "pydantic",
        "--hidden-import", "starlette",
        "--hidden-import", "httptools",
        "--hidden-import", "websockets",
        "--hidden-import", "watchfiles",
        "--collect-all", "chatterbox",
        "--noconfirm",
        "start_chatterbox_api.py"
    )
    
    Write-Host "Running: pyinstaller $($PyInstallerArgs -join ' ')"
    & pyinstaller @PyInstallerArgs
    
    if (-not (Test-Path "dist\chatterbox_server.exe")) {
        Write-Err "Build failed - executable not found"
        exit 1
    }
    
    Write-Success "Executable built successfully"

    # Step 6: Copy to output directory
    Write-Step "Copying executable to $OutputFullPath..."
    
    # Create output directory if needed
    if (-not (Test-Path $OutputFullPath)) {
        New-Item -ItemType Directory -Path $OutputFullPath -Force | Out-Null
    }
    
    Copy-Item "dist\chatterbox_server.exe" "$OutputFullPath\chatterbox_server.exe" -Force
    Write-Success "Executable copied to $OutputFullPath"

    # Step 7: Verify
    Write-Step "Verifying build..."
    $ExePath = Join-Path $OutputFullPath "chatterbox_server.exe"
    if (Test-Path $ExePath) {
        $FileInfo = Get-Item $ExePath
        Write-Host "  File: $ExePath"
        Write-Host "  Size: $([math]::Round($FileInfo.Length / 1MB, 2)) MB"
        Write-Host "  Date: $($FileInfo.LastWriteTime)"
        Write-Success "Build verification passed"
    } else {
        Write-Err "Build verification failed - file not found"
        exit 1
    }

} finally {
    Pop-Location
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Build Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $OutputFullPath\chatterbox_server.exe"
Write-Host ""
Write-Host "To test the build:"
Write-Host "  1. Run: .\$OutputPath\chatterbox_server.exe --port 4123"
Write-Host "  2. Test: curl http://127.0.0.1:4123/health"
Write-Host ""
