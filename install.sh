#!/usr/bin/env bash
# ClaudeClaw One-Line Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/tv7/C-Claw/main/install.sh | bash

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${CYAN}→${NC} $1"; }

echo -e "${CYAN}${BOLD}"
cat << 'EOF'
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
EOF
echo -e "${NC}"
echo -e "${BOLD}ClaudeClaw Installer${NC}\n"

# ── Check OS ──────────────────────────────────────────────────────────────────
PLATFORM="linux"
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="macos"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  PLATFORM="windows"
fi
info "Platform: $PLATFORM"

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org and re-run this script."
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  fail "Node.js $NODE_VERSION found, but 20+ is required. Install from https://nodejs.org"
fi
ok "Node.js $NODE_VERSION"

# ── Check npm ─────────────────────────────────────────────────────────────────
if ! command -v npm &> /dev/null; then
  fail "npm not found. Install Node.js from https://nodejs.org"
fi
ok "npm $(npm --version)"

# ── Check claude CLI ──────────────────────────────────────────────────────────
if ! command -v claude &> /dev/null; then
  warn "claude CLI not found."
  info "Install it from: https://claude.ai/code"
  info "After installing, run: claude login"
  info "Then re-run this installer."
  echo ""
  read -p "Continue anyway? (y/N): " CONTINUE
  [[ "$CONTINUE" =~ ^[Yy]$ ]] || exit 1
else
  ok "claude CLI: $(claude --version 2>&1 | head -1)"
fi

# ── Choose install directory ───────────────────────────────────────────────────
DEFAULT_DIR="$HOME/claudeclaw"
echo ""
read -p "Install directory [$DEFAULT_DIR]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_DIR}"

# ── Clone or update ───────────────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
  ok "Updated"
elif [[ -d "$INSTALL_DIR" ]]; then
  fail "$INSTALL_DIR already exists but is not a git repo. Choose a different directory."
else
  info "Cloning ClaudeClaw to $INSTALL_DIR..."
  git clone https://github.com/tv7/C-Claw.git "$INSTALL_DIR"
  ok "Cloned"
fi

cd "$INSTALL_DIR"

# ── Install dependencies ───────────────────────────────────────────────────────
info "Installing dependencies..."
npm install --legacy-peer-deps --silent
ok "Dependencies installed"

# ── Build ─────────────────────────────────────────────────────────────────────
info "Building..."
npm run build --silent
ok "Build complete"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}ClaudeClaw installed successfully!${NC}"
echo ""
echo "Next step — run the setup wizard:"
echo -e "  ${CYAN}cd $INSTALL_DIR && npm run setup${NC}"
echo ""
echo "The wizard will:"
echo "  1. Walk you through getting a Telegram bot token"
echo "  2. Configure optional features (voice, scheduler, etc.)"
echo "  3. Install ClaudeClaw as a background service"
echo "  4. Get your Telegram chat ID"
echo ""
echo "After setup, start the bot:"
echo -e "  ${CYAN}npm run start${NC}"
echo ""
