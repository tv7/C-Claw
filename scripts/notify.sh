#!/usr/bin/env bash
# notify.sh — send a Telegram message from shell (for progress updates from Claude)
# Usage: ./scripts/notify.sh "Your message here"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env not found at $PROJECT_ROOT/.env" >&2
  exit 1
fi

# Parse .env
while IFS='=' read -r key value; do
  [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  export "$key=$value"
done < "$ENV_FILE"

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${ALLOWED_CHAT_ID:-}"
MESSAGE="${1:-}"

if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
  echo "Error: TELEGRAM_BOT_TOKEN and ALLOWED_CHAT_ID must be set in .env" >&2
  exit 1
fi

if [[ -z "$MESSAGE" ]]; then
  echo "Usage: $0 \"Your message\"" >&2
  exit 1
fi

curl -s -X POST \
  "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  -d "parse_mode=HTML" \
  > /dev/null

echo "Message sent."
