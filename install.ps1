# ClaudeClaw One-Line Windows Installer
# Usage: irm https://raw.githubusercontent.com/tv7/C-Claw/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host " ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗" -ForegroundColor Cyan
Write-Host "██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝" -ForegroundColor Cyan
Write-Host "██║     ██║     ███████║██║   ██║██║  ██║█████╗  " -ForegroundColor Cyan
Write-Host "██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  " -ForegroundColor Cyan
Write-Host "╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗" -ForegroundColor Cyan
Write-Host " ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "ClaudeClaw Windows Installer" -ForegroundColor White
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node --version 2>&1
    $nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
    if ($nodeMajor -lt 20) {
        Write-Host "✗ Node.js $nodeVersion found but 20+ required." -ForegroundColor Red
        Write-Host "  Install from: https://nodejs.org" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "✓ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. Install from: https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check git
try {
    git --version | Out-Null
    Write-Host "✓ git available" -ForegroundColor Green
} catch {
    Write-Host "✗ git not found. Install from: https://git-scm.com" -ForegroundColor Red
    exit 1
}

# Install directory
$defaultDir = "$env:USERPROFILE\claudeclaw"
$installDir = Read-Host "Install directory [$defaultDir]"
if ([string]::IsNullOrWhiteSpace($installDir)) { $installDir = $defaultDir }

# Clone or update
if (Test-Path "$installDir\.git") {
    Write-Host "→ Updating existing installation..." -ForegroundColor Cyan
    git -C $installDir pull --ff-only
    Write-Host "✓ Updated" -ForegroundColor Green
} elseif (Test-Path $installDir) {
    Write-Host "✗ $installDir exists but is not a git repo. Choose a different directory." -ForegroundColor Red
    exit 1
} else {
    Write-Host "→ Cloning ClaudeClaw to $installDir..." -ForegroundColor Cyan
    git clone https://github.com/tv7/C-Claw.git $installDir
    Write-Host "✓ Cloned" -ForegroundColor Green
}

Set-Location $installDir

# Install dependencies
Write-Host "→ Installing dependencies..." -ForegroundColor Cyan
npm install --legacy-peer-deps --silent
Write-Host "✓ Dependencies installed" -ForegroundColor Green

# Build
Write-Host "→ Building..." -ForegroundColor Cyan
npm run build
Write-Host "✓ Build complete" -ForegroundColor Green

Write-Host ""
Write-Host "ClaudeClaw installed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next step - run the setup wizard:"
Write-Host "  cd $installDir" -ForegroundColor Cyan
Write-Host "  npm run setup" -ForegroundColor Cyan
Write-Host ""
Write-Host "For background running on Windows, install PM2:"
Write-Host "  npm install -g pm2" -ForegroundColor Cyan
Write-Host "  pm2 start dist/index.js --name claudeclaw" -ForegroundColor Cyan
Write-Host "  pm2 startup && pm2 save" -ForegroundColor Cyan
Write-Host ""
