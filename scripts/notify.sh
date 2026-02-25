#!/usr/bin/env bash
# Send a Telegram message from the shell.
# Usage: ./scripts/notify.sh "your message here"
# Reads TELEGRAM_BOT_TOKEN and ALLOWED_CHAT_ID from .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $PROJECT_ROOT/.env" >&2
  exit 1
fi

BOT_TOKEN=""
CHAT_ID=""

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^# ]] && continue
  [[ -z "$line" ]] && continue

  key="${line%%=*}"
  val="${line#*=}"
  val="${val#\"}" ; val="${val%\"}"
  val="${val#\'}" ; val="${val%\'}"

  case "$key" in
    TELEGRAM_BOT_TOKEN) BOT_TOKEN="$val" ;;
    ALLOWED_CHAT_ID)    CHAT_ID="$val" ;;
    ALLOWED_CHAT_IDS)
      if [[ -z "$CHAT_ID" ]]; then
        CHAT_ID="${val%%,*}"
      fi
      ;;
  esac
done < "$ENV_FILE"

if [[ -z "$BOT_TOKEN" ]]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in .env" >&2
  exit 1
fi

if [[ -z "$CHAT_ID" ]]; then
  echo "Error: ALLOWED_CHAT_ID not found in .env" >&2
  exit 1
fi

MESSAGE="${1:-}"
if [[ -z "$MESSAGE" ]]; then
  echo "Usage: $0 \"your message\"" >&2
  exit 1
fi

curl -s -X POST \
  "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  > /dev/null

echo "Sent: $MESSAGE"
