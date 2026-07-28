#!/usr/bin/env bash
set -euo pipefail

# ── App Store Connect MCP — Interactive Installer ──────────────────────────
# Detects installed coding agents, installs the MCP server, and configures
# your chosen agent(s).  Privileged credentials stay in a private directory;
# the script never sees your .p8 key.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

HEADER()  { printf "\n${BOLD}${CYAN}══ %s ══${NC}\n\n" "$*"; }
OK()      { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
WARN()    { printf "  ${YELLOW}⚠${NC}  %s\n" "$*"; }
FAIL()    { printf "  ${RED}✗${NC} %s\n" "$*"; }
ASK()     { printf "${BOLD}›${NC} %s " "$*"; }

# ── Paths ──────────────────────────────────────────────────────────────────
INSTALL_DIR="${HOME}/.local/share/appstore-connect-mcp"
CONFIG_DIR="${HOME}/.config/appstore-connect-mcp"
ENV_FILE="${CONFIG_DIR}/env"

# ── Check prerequisites ────────────────────────────────────────────────────
HEADER "Checking prerequisites"

if ! command -v node &>/dev/null; then
    FAIL "Node.js is not installed.  Install Node.js 22+ and re-run."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    FAIL "Node.js $(node -v) found — need 22+.  Upgrade and re-run."
    exit 1
fi
OK "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
    FAIL "npm not found.  Re-install Node.js and re-run."
    exit 1
fi
OK "npm $(npm -v)"

# ── Detect installed agents ────────────────────────────────────────────────
HEADER "Detecting coding agents"

AGENTS=()
agent_hermes=false
agent_claude=false
agent_codex=false
agent_opencode=false

command -v hermes  &>/dev/null && { AGENTS+=("Hermes Agent");  agent_hermes=true;  OK "Hermes Agent  $(hermes --version 2>/dev/null || true)"; }  || true
command -v claude  &>/dev/null && { AGENTS+=("Claude Code");   agent_claude=true;   OK "Claude Code   $(claude --version 2>/dev/null || true)";  }  || true
command -v codex   &>/dev/null && { AGENTS+=("Codex CLI");     agent_codex=true;    OK "Codex CLI     $(codex --version 2>/dev/null || true)";     }  || true
command -v opencode &>/dev/null && { AGENTS+=("OpenCode");     agent_opencode=true;  OK "OpenCode      $(opencode --version 2>/dev/null || true)";   }  || true

if [ ${#AGENTS[@]} -eq 0 ]; then
    WARN "No supported coding agents detected.  You can still install the MCP"
    echo "     server manually — configuration snippets are printed at the end."
    echo
fi

# ── Choose agents ──────────────────────────────────────────────────────────
SELECTED=()

if [ ${#AGENTS[@]} -gt 0 ]; then
    HEADER "Choose agents to configure"
    echo "  Found: ${AGENTS[*]}"
    echo
    if [ ${#AGENTS[@]} -eq 1 ]; then
        printf "  Configure ${AGENTS[0]}? [Y/n] "
        read -r answer
        [[ "$answer" =~ ^[Nn] ]] || SELECTED+=("${AGENTS[0]}")
    else
        echo "  Enter numbers separated by spaces, or 'all':"
        echo
        for i in "${!AGENTS[@]}"; do
            printf "    %d) %s\n" "$((i+1))" "${AGENTS[$i]}"
        done
        echo
        ASK "Your choice"
        read -r choice
        if [ "$choice" = "all" ] || [ "$choice" = "ALL" ]; then
            SELECTED=("${AGENTS[@]}")
        else
            for num in $choice; do
                idx=$((num-1))
                if [ -n "${AGENTS[$idx]:-}" ]; then
                    SELECTED+=("${AGENTS[$idx]}")
                fi
            done
        fi
    fi
fi

echo
if [ ${#SELECTED[@]} -gt 0 ]; then
    echo "  Will configure: ${SELECTED[*]}"
else
    echo "  Skipping agent configuration — you can do it manually later."
fi

# ── Install MCP server ─────────────────────────────────────────────────────
HEADER "Installing App Store Connect MCP"

if [ -d "$INSTALL_DIR" ]; then
    printf "  ${YELLOW}⚠${NC}  %s already exists. Overwrite? [y/N] " "$INSTALL_DIR"
    read -r ow
    if [[ "$ow" =~ ^[Yy] ]]; then
        rm -rf "$INSTALL_DIR"
    else
        echo "  Keeping existing installation."
    fi
fi

if [ ! -d "$INSTALL_DIR" ]; then
    echo "  Cloning into $INSTALL_DIR …"
    git clone --quiet https://github.com/emre-koc/appstore-connect-mcp.git "$INSTALL_DIR"
    OK "Cloned"
fi

echo "  Installing dependencies …"
(cd "$INSTALL_DIR" && npm ci --ignore-scripts --quiet)
OK "Dependencies installed"

echo "  Building …"
(cd "$INSTALL_DIR" && npm run build --silent 2>/dev/null || npm run build)
OK "Build complete"

# ── Create credential directory ────────────────────────────────────────────
HEADER "Credentials"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# .env file
if [ -f "$ENV_FILE" ]; then
    WARN "$ENV_FILE already exists — leaving it untouched."
else
    cat > "$ENV_FILE" <<'ENVEOF'
# App Store Connect MCP — private environment
# Keep this file mode 600.  Never commit it.

ASC_KEY_ID=YOUR_KEY_ID
ASC_ISSUER_ID=YOUR_ISSUER_ID
ASC_PRIVATE_KEY_PATH=/absolute/path/to/AuthKey_YOUR_KEY_ID.p8

# Recommended — scope to specific apps:
ASC_ALLOWED_APP_IDS=

# Keep disabled except during a planned mutation session:
ASC_ENABLE_MUTATIONS=false

# Optional — reserved for future tools:
ASC_VENDOR_NUMBER=
ENVEOF
    chmod 600 "$ENV_FILE"
    OK "Created $ENV_FILE"
fi

# ── Key-file reminder ──────────────────────────────────────────────────────
echo
printf "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${YELLOW}║  ACTION REQUIRED                                            ║${NC}\n"
printf "${BOLD}${YELLOW}╠══════════════════════════════════════════════════════════════╣${NC}\n"
printf "${BOLD}${YELLOW}║                                                              ║${NC}\n"
printf "${BOLD}${YELLOW}║  Copy your .p8 private key to:                               ║${NC}\n"
printf "${BOLD}${YELLOW}║    %-55s ║${NC}\n" "$CONFIG_DIR/"
printf "${BOLD}${YELLOW}║                                                              ║${NC}\n"
printf "${BOLD}${YELLOW}║    cp /path/to/AuthKey_XXXXXXXXXX.p8 %s/ ║${NC}\n" "$CONFIG_DIR"
printf "${BOLD}${YELLOW}║    chmod 600 %s/AuthKey_*.p8               ║${NC}\n" "$CONFIG_DIR"
printf "${BOLD}${YELLOW}║                                                              ║${NC}\n"
printf "${BOLD}${YELLOW}║  Then update ASC_PRIVATE_KEY_PATH in:                        ║${NC}\n"
printf "${BOLD}${YELLOW}║    %-55s ║${NC}\n" "$ENV_FILE"
printf "${BOLD}${YELLOW}║                                                              ║${NC}\n"
printf "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}\n"

# ── Resolve absolute paths for agent configs ───────────────────────────────
NODE_BIN=$(command -v node)
SERVER_JS="${INSTALL_DIR}/dist/index.js"

echo

# ── Configure agents ───────────────────────────────────────────────────────
for agent in "${SELECTED[@]}"; do
    case "$agent" in
        "Hermes Agent")
            HEADER "Configuring Hermes Agent"
            if [ -f "${HOME}/.hermes/config.yaml" ]; then
                WARN "~/.hermes/config.yaml exists — add this block under mcp_servers:"
            else
                echo "  Add this to your Hermes configuration:"
            fi
            echo
            printf "  ${CYAN}mcp_servers:${NC}\n"
            printf "  ${CYAN}  appstore_connect:${NC}\n"
            printf "  ${CYAN}    command: \"%s\"${NC}\n" "$NODE_BIN"
            printf "  ${CYAN}    args:${NC}\n"
            printf "  ${CYAN}      - \"--env-file=%s\"${NC}\n" "$ENV_FILE"
            printf "  ${CYAN}      - \"%s\"${NC}\n" "$SERVER_JS"
            printf "  ${CYAN}    connect_timeout: 30${NC}\n"
            printf "  ${CYAN}    timeout: 120${NC}\n"
            printf "  ${CYAN}    sampling:${NC}\n"
            printf "  ${CYAN}      enabled: false${NC}\n"
            echo
            echo "  Then restart Hermes.  Tools appear as mcp_appstore_connect_*."
            ;;

        "Claude Code")
            HEADER "Configuring Claude Code"
            if command -v claude &>/dev/null && claude mcp list &>/dev/null 2>&1; then
                echo "  Adding via claude mcp …"
                claude mcp add -s user appstore-connect -- \
                    "$NODE_BIN" \
                    "--env-file=$ENV_FILE" \
                    "$SERVER_JS" 2>/dev/null && \
                    OK "Added to Claude Code (user scope)" || \
                    WARN "CLI add failed — use manual config below"
            fi
            echo
            echo "  Or add manually to ~/.claude.json or .claude/settings.json:"
            echo
            echo '  {'
            echo '    "mcpServers": {'
            echo '      "appstore-connect": {'
            printf '        "command": "%s",\n' "$NODE_BIN"
            echo '        "args": ['
            printf '          "--env-file=%s",\n' "$ENV_FILE"
            printf '          "%s"\n' "$SERVER_JS"
            echo '        ]'
            echo '      }'
            echo '    }'
            echo '  }'
            echo
            echo "  Restart Claude Code.  Tools are available directly by name."
            ;;

        "Codex CLI")
            HEADER "Configuring Codex CLI"
            if command -v codex &>/dev/null; then
                echo "  Adding via codex mcp …"
                codex mcp add -s user appstore-connect -- \
                    "$NODE_BIN" \
                    "--env-file=$ENV_FILE" \
                    "$SERVER_JS" 2>/dev/null && \
                    OK "Added to Codex CLI (user scope)" || \
                    WARN "CLI add failed — use manual config below"
            fi
            echo
            echo "  Or add manually to ~/.codex/config.toml:"
            echo
            echo '  [mcp_servers.appstore-connect]'
            printf '  command = "%s"\n' "$NODE_BIN"
            printf '  args = ["--env-file=%s", "%s"]\n' "$ENV_FILE" "$SERVER_JS"
            echo
            echo "  Restart Codex.  Tools appear as mcp__appstore_connect__<name>."
            ;;

        "OpenCode")
            HEADER "Configuring OpenCode"
            if command -v opencode &>/dev/null; then
                echo "  Adding via opencode mcp …"
                opencode mcp add appstore-connect -- \
                    "$NODE_BIN" \
                    "--env-file=$ENV_FILE" \
                    "$SERVER_JS" 2>/dev/null && \
                    OK "Added to OpenCode" || \
                    WARN "CLI add failed — use manual config below"
            fi
            echo
            echo "  Or add manually to ~/.config/opencode/config.json:"
            echo
            echo '  {'
            echo '    "mcpServers": {'
            echo '      "appstore-connect": {'
            printf '        "command": "%s",\n' "$NODE_BIN"
            echo '        "args": ['
            printf '          "--env-file=%s",\n' "$ENV_FILE"
            printf '          "%s"\n' "$SERVER_JS"
            echo '        ]'
            echo '      }'
            echo '    }'
            echo '  }'
            echo
            echo "  Restart OpenCode.  Tools are available as regular MCP tools."
            ;;
    esac
    echo
done

# ── Final summary ──────────────────────────────────────────────────────────
HEADER "Done"

echo "  Installed to:  $INSTALL_DIR"
echo "  Config at:     $ENV_FILE"
echo "  Key directory: $CONFIG_DIR/"
echo
echo "  Next steps:"
echo "    1. Copy your .p8 key into $CONFIG_DIR/"
echo "    2. Edit $ENV_FILE with your real key ID, issuer ID, and key path"
echo "    3. Restart your coding agent"
echo "    4. Run list_apps to verify everything works"
echo
