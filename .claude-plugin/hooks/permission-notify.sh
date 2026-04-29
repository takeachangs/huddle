#!/bin/bash
# Notify the huddle channel when this session needs user approval.
# Exits 0 without a decision JSON so Claude Code shows its normal prompt.

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
SESSION="${HUDDLE_SESSION:-$(basename "$PWD")}"

case "$TOOL_NAME" in
  Bash)
    DETAIL=$(echo "$INPUT" | jq -r '.tool_input.command // ""' | head -c 120)
    ;;
  Write|Edit|MultiEdit)
    DETAIL=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
    ;;
  *)
    DETAIL=$(echo "$INPUT" | jq -r '.tool_input | tostring' | head -c 120)
    ;;
esac

huddle send "@user **${SESSION}** needs approval — ${TOOL_NAME}: \`${DETAIL}\`" 2>/dev/null || true

exit 0
