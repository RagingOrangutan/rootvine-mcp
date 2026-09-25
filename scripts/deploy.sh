#!/bin/bash
# =============================================================================
# RootVine — Deploy Script (rootvine.ai site + mcp.rootvine.ai hosted endpoint)
# =============================================================================
# Usage: run as the `rootvine` user, NEVER as root (Deploy Playbook,
# non-negotiable #1; workspace CLAUDE.md rule 9):
#
#   su - rootvine -c "bash ~/repos/rootvine-mcp/scripts/deploy.sh"
#
# Why not root, when ShroudedOrangutan and PennyBlack run as root: running as
# root needs `sudo -u` wrappers on every git call, and BeatsVine removed exactly
# those wrappers after the sudoers config broke production three times in one
# day (2026-05-16). As the service user there is nothing to wrap and no
# ownership to repair afterwards.
#
# What it deploys:
#   - the contents of site/ (llms.txt, index.html) into ~/htdocs/www.rootvine.ai
#   - the hosted MCP endpoint (dist/hosted.js) under PM2 as `rootvine-mcp`,
#     listening on 127.0.0.1:3009 behind the mcp.rootvine.ai nginx site
#
# What it does NOT deploy: the npm package. That ships with `npm publish` —
# see Obsidian: Standards/Publishing RootVine to npm.
#
#   Site
#   1. Preflight: refuse root, confirm the repo is on main with a clean tree
#   2. Pull latest (fast-forward only — this box never makes commits)
#   3. Confirm the site files exist BEFORE touching the live directory
#   4. Copy site/ into htdocs
#   5. Check the live site: status codes, content types, llms.txt byte-for-byte
#   Hosted endpoint
#   6. Toolchain: node >= 20, npm, pm2 (nvm loaded if the user has it)
#   7. Install (npm ci, dev tools included) + security gate (npm audit, high+)
#   8. Build into dist-staging while the running version keeps serving
#   9. Swap dist-staging in and (re)start rootvine-mcp once
#  10. Check it: /health reports this version, a real MCP handshake lists the
#      five tools. On failure: swap the previous build back automatically.
#      `pm2 save` only after a green check (Playbook, 2026-09-20).
#
# The site never rolls back: for two static files, the previous version is one
# `git checkout` away, and an automatic rollback can restore something worse.
# =============================================================================

# Paths can be overridden from the environment FOR TESTING ONLY. In production
# run it with no variables set and these defaults apply.
SERVICE_USER="${SERVICE_USER:-rootvine}"
REPO_DIR="${REPO_DIR:-/home/rootvine/repos/rootvine-mcp}"
SITE_DIR="${SITE_DIR:-/home/rootvine/htdocs/www.rootvine.ai}"
CHECK_IP="${CHECK_IP:-127.0.0.1}"   # checks hit THIS box's nginx, not whatever DNS says
BRANCH="main"
DOMAIN="www.rootvine.ai"
APEX="rootvine.ai"
MCP_DOMAIN="mcp.rootvine.ai"
MCP_NAME="rootvine-mcp"             # the PM2 process name (ecosystem.config.cjs)
MCP_LOCAL="http://127.0.0.1:3009"   # RootVine's pinned port
TOTAL_STEPS=10

set -e
set -E            # the ERR trap reaches functions and substitutions too
set -o pipefail
# `set -e` alone aborts silently (Playbook lesson 4, 2026-09-19). Say where.
trap 'echo "!! deploy.sh aborted at line $LINENO (exit $?)" >&2' ERR

fail() { echo ""; echo "!! $1" >&2; echo ""; exit 1; }

# pm2's CLI has no RPC timeout; a wedged daemon would hang the script (Playbook,
# 2026-09-20). --foreground so Ctrl-C still reaches it. PM2_BIN is the real
# executable, located in step 6 with `type -P` (which, unlike `command -v`,
# does not find this function).
PM2_BIN=""
pm2() { timeout --foreground 120 "${PM2_BIN:?pm2 has not been located}" "$@"; }

# The whole script sits inside main() and is only CALLED on the last line.
# Step 2 pulls this very file; bash reads scripts as it runs them, so a pull
# that changes deploy.sh mid-run would otherwise execute a mixture of the old
# and new versions. Wrapping it makes bash parse everything before step 1.
main() {
    echo ""
    echo "========================================="
    echo "  RootVine - Deploy"
    echo "  rootvine.ai site + $MCP_DOMAIN"
    echo "========================================="
    echo ""

    # ── Step 1: Preflight ────────────────────────────────────────────────
    echo "[1/$TOTAL_STEPS] Preflight..."
    if [ "$(id -u)" -eq 0 ]; then
        fail "Refusing to run as root. Run: su - $SERVICE_USER -c \"bash $REPO_DIR/scripts/deploy.sh\""
    fi
    if [ "$(whoami)" != "$SERVICE_USER" ]; then
        fail "Running as '$(whoami)', expected '$SERVICE_USER'."
    fi
    [ -d "$REPO_DIR/.git" ] || fail "No git repo at $REPO_DIR. See the first-time setup in Obsidian: Git Commands."
    [ -d "$SITE_DIR" ]      || fail "Site directory $SITE_DIR does not exist. Is the CloudPanel site set up?"
    cd "$REPO_DIR"
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD)"
    [ "$branch" = "$BRANCH" ] || fail "Repo is on '$branch', not '$BRANCH'."
    if ! git diff --quiet || ! git diff --cached --quiet; then
        fail "The repo has local edits. Nobody should edit files on the server — see 'git status' in $REPO_DIR."
    fi
    echo "  Done."
    echo ""

    # ── Step 2: Pull ─────────────────────────────────────────────────────
    echo "[2/$TOTAL_STEPS] Pulling latest code..."
    local old_head new_head
    old_head="$(git rev-parse --short HEAD)"
    timeout --foreground 300 git pull --ff-only --quiet origin "$BRANCH"
    new_head="$(git rev-parse --short HEAD)"
    if [ "$old_head" = "$new_head" ]; then
        echo "  Already up to date at $new_head. Redeploying the same files."
    else
        echo "  $old_head -> $new_head"
    fi
    echo ""

    # ── Step 3: Confirm the files exist before touching anything live ────
    echo "[3/$TOTAL_STEPS] Checking site files..."
    local f
    for f in index.html llms.txt; do
        [ -s "$REPO_DIR/site/$f" ] || fail "site/$f is missing or empty. Nothing has been changed on the live site."
    done
    echo "  Done."
    echo ""

    # ── Step 4: Deploy the site ──────────────────────────────────────────
    # `*` does not match dot-files, so .well-known (SSL certificate renewal)
    # survives the clear-out.
    echo "[4/$TOTAL_STEPS] Deploying site -> $SITE_DIR"
    rm -rf "${SITE_DIR:?}"/*
    cp -r "$REPO_DIR/site/"* "$SITE_DIR/"
    echo "  Done."
    echo ""

    # ── Step 5: Check the live site ──────────────────────────────────────
    echo "[5/$TOTAL_STEPS] Checking the live site..."
    local site_failures=0
    local resolve=(--resolve "$DOMAIN:443:$CHECK_IP" --resolve "$APEX:443:$CHECK_IP")

    # check <label> <url> <expected status> <expected content-type fragment or ->
    check() {
        local label="$1" url="$2" want_status="$3" want_type="$4" got_status got_type
        got_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${resolve[@]}" "$url" || true)"
        got_type="$(curl -s -o /dev/null -w '%{content_type}' --max-time 15 "${resolve[@]}" "$url" || true)"
        if [ "$got_status" != "$want_status" ]; then
            echo "  FAIL  $label — status $got_status, expected $want_status"
            site_failures=$((site_failures + 1))
        elif [ "$want_type" != "-" ] && ! echo "$got_type" | grep -qi "$want_type"; then
            echo "  FAIL  $label — type '$got_type', expected '$want_type'"
            site_failures=$((site_failures + 1))
        else
            echo "  ok    $label ($got_status${got_type:+, $got_type})"
        fi
    }

    check "home page"          "https://$DOMAIN/"               200 "text/html"
    check "llms.txt"           "https://$DOMAIN/llms.txt"       200 "text/plain"
    check "llms.txt charset"   "https://$DOMAIN/llms.txt"       200 "charset=utf-8"
    check "apex redirects"     "https://$APEX/"                 301 "-"
    check "unknown page is 404" "https://$DOMAIN/no-such-page-$$" 404 "-"

    # The strongest check: what nginx serves must BE the file in the repo.
    # Catches a wrong document root, a stale copy, or a caching layer.
    local served_sum repo_sum
    served_sum="$(curl -s --max-time 15 "${resolve[@]}" "https://$DOMAIN/llms.txt" | sha256sum | cut -d' ' -f1 || true)"
    repo_sum="$(sha256sum < "$REPO_DIR/site/llms.txt" | cut -d' ' -f1)"
    if [ "$served_sum" = "$repo_sum" ]; then
        echo "  ok    served llms.txt matches the repo byte for byte"
    else
        echo "  FAIL  served llms.txt differs from the repo copy"
        site_failures=$((site_failures + 1))
    fi
    if [ "$site_failures" -gt 0 ]; then
        echo "  The site files ARE deployed, but something about the live site is wrong."
        echo "  To go back to the previous version:"
        echo "    cd $REPO_DIR && git checkout $old_head -- site/"
        echo "    cp -r $REPO_DIR/site/* $SITE_DIR/"
        echo "    git checkout $BRANCH -- site/"
        echo "  Carrying on with the hosted endpoint; the summary at the end repeats this."
    fi
    echo ""

    # ── Step 6: Toolchain ────────────────────────────────────────────────
    # `su - user -c` is a non-interactive login shell: ~/.bashrc returns before
    # nvm loads (Playbook lesson 2, 2026-09-19), so load it here if it exists.
    echo "[6/$TOTAL_STEPS] Toolchain..."
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        set +e; set +o pipefail; trap - ERR
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh" --no-use
        nvm use --silent default >/dev/null 2>&1
        set -e; set -o pipefail; trap 'echo "!! deploy.sh aborted at line $LINENO (exit $?)" >&2' ERR
        echo "  nvm loaded"
    fi
    type -P node >/dev/null 2>&1 || fail "No 'node' for $SERVICE_USER. See 'First deploy of mcp.rootvine.ai' in Obsidian: Git Commands."
    type -P npm  >/dev/null 2>&1 || fail "No 'npm' for $SERVICE_USER."
    PM2_BIN="$(type -P pm2 || true)"
    [ -n "$PM2_BIN" ] || fail "No 'pm2' for $SERVICE_USER. See 'First deploy of mcp.rootvine.ai' in Obsidian: Git Commands."
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
        || fail "Node $(node -v) is too old; the hosted endpoint needs Node 20 or newer."
    echo "  node $(node -v) ($(type -P node))"
    echo "  npm  $(npm -v)"
    echo "  pm2  $PM2_BIN"
    echo "  NODE_ENV=${NODE_ENV:-<unset>}  (the install below includes dev tools either way)"
    echo ""

    # ── Step 7: Install + security gate ──────────────────────────────────
    echo "[7/$TOTAL_STEPS] Installing dependencies..."
    # --include=dev beats any `omit` a login-shell NODE_ENV=production sets
    # (Playbook lesson 6, 2026-09-19): the build needs TypeScript.
    timeout --foreground 300 npm ci --include=dev --no-audit --no-fund --loglevel=error
    [ -x node_modules/.bin/tsc ] || fail "npm ci finished without TypeScript (node_modules/.bin/tsc). The running version is untouched."
    if ! timeout --foreground 120 npm audit --audit-level=high >/dev/null 2>&1; then
        timeout --foreground 120 npm audit --audit-level=high || true
        fail "npm audit found a high or critical vulnerability. The running version is untouched."
    fi
    echo "  Done (npm audit: nothing high or critical)."
    echo ""

    # ── Step 8: Build into staging ───────────────────────────────────────
    echo "[8/$TOTAL_STEPS] Building into dist-staging (the running version keeps serving)..."
    rm -rf dist-staging
    timeout --foreground 300 node_modules/.bin/tsc --outDir dist-staging
    [ -s dist-staging/hosted.js ] || fail "The build produced no dist-staging/hosted.js. The running version is untouched."
    echo "  Done."
    echo ""

    # ── Step 9: Swap and (re)start once ──────────────────────────────────
    echo "[9/$TOTAL_STEPS] Swapping in the new build and (re)starting $MCP_NAME..."
    pm2 ping >/dev/null
    rm -rf dist-prev
    [ -d dist ] && mv dist dist-prev
    mv dist-staging dist
    pm2 startOrReload ecosystem.config.cjs --update-env >/dev/null
    echo "  Done."
    echo ""

    # ── Step 10: Check the endpoint, roll back if it is broken ───────────
    echo "[10/$TOTAL_STEPS] Checking $MCP_NAME..."
    local want_version
    want_version="$(node -p "require('./package.json').version")"
    if mcp_healthy "$want_version"; then
        pm2 save >/dev/null
        echo "  pm2 process list saved (survives a reboot once PM2 startup is registered)"
    else
        echo ""
        echo "  !! $MCP_NAME failed its checks. Rolling back..."
        if [ -d dist-prev ]; then
            rm -rf dist-failed
            mv dist dist-failed
            mv dist-prev dist
            pm2 restart "$MCP_NAME" --update-env >/dev/null
            if mcp_healthy ""; then
                pm2 save >/dev/null
                echo "  Rolled back: the previous build is serving again. The failed one is in dist-failed/."
            else
                echo "  !! The previous build ALSO fails its checks. Not saving the pm2 list."
            fi
        else
            # First deploy: nothing to go back to. Remove the process this run
            # created (it was never saved) so a reboot cannot resurrect it.
            pm2 delete "$MCP_NAME" >/dev/null 2>&1 || true
            rm -rf dist-failed
            mv dist dist-failed
            echo "  First deploy, nothing to roll back to: $MCP_NAME removed, the build kept in dist-failed/."
        fi
        echo "  Logs: pm2 logs $MCP_NAME --lines 50 --nostream"
        fail "The hosted endpoint did not come up healthy. See the lines above."
    fi

    # Through nginx: only a warning, because the CloudPanel site (and its SSL
    # certificate) is set up once by hand, after the first deploy.
    local public_status
    public_status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$MCP_DOMAIN:443:$CHECK_IP" "https://$MCP_DOMAIN/health" || true)"
    if [ "$public_status" = "200" ]; then
        echo "  ok    https://$MCP_DOMAIN/health through nginx"
    else
        echo "  WARN  https://$MCP_DOMAIN/health through nginx answered '$public_status', not 200."
        echo "        The endpoint itself is healthy. If the CloudPanel reverse-proxy site for"
        echo "        $MCP_DOMAIN (-> http://127.0.0.1:3009) or its SSL certificate is not set up"
        echo "        yet, that is expected. See 'First deploy of mcp.rootvine.ai' in Obsidian: Git Commands."
    fi
    if ! systemctl is-enabled "pm2-$SERVICE_USER" >/dev/null 2>&1; then
        echo "  WARN  PM2 is not registered to start at boot for $SERVICE_USER, so a VPS reboot"
        echo "        would leave $MCP_NAME stopped. One-time fix, as root:"
        echo "          su - $SERVICE_USER -c \"pm2 startup systemd\"   (then run the line it prints, as root)"
    fi
    echo ""

    echo "========================================="
    if [ "$site_failures" -gt 0 ]; then
        echo "  !!! $site_failures SITE CHECK(S) FAILED — see step 5 !!!"
        echo "  The hosted endpoint deployed and is healthy ($new_head)."
        echo "========================================="
        echo ""
        exit 1
    fi
    echo "  Deploy complete! ($new_head)"
    echo "  Site:     https://$DOMAIN"
    echo "  llms.txt: https://$DOMAIN/llms.txt"
    echo "  MCP:      https://$MCP_DOMAIN/mcp"
    echo "========================================="
    echo ""
}

# mcp_healthy <expected version, or empty for any>
# /health must answer (up to ~15s after a restart) with the expected version,
# and a real MCP handshake must list the five tools.
mcp_healthy() {
    local want="$1" health="" i
    for i in $(seq 1 15); do
        health="$(curl -s --max-time 5 "$MCP_LOCAL/health" || true)"
        [ -n "$health" ] && break
        sleep 1
    done
    if [ -z "$health" ]; then
        echo "  FAIL  $MCP_LOCAL/health did not answer"
        return 1
    fi
    if [ -n "$want" ] && ! echo "$health" | grep -q "\"version\":\"$want\""; then
        echo "  FAIL  /health answered '$health', expected version $want"
        return 1
    fi
    echo "  ok    /health ($health)"

    local accept="application/json, text/event-stream" init tools t
    init="$(curl -s --max-time 10 -X POST "$MCP_LOCAL/mcp" \
        -H "Content-Type: application/json" -H "Accept: $accept" \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-check","version":"1"}}}' || true)"
    if ! echo "$init" | grep -q '"name":"rootvine-mcp"'; then
        echo "  FAIL  MCP initialize did not identify rootvine-mcp"
        return 1
    fi
    tools="$(curl -s --max-time 10 -X POST "$MCP_LOCAL/mcp" \
        -H "Content-Type: application/json" -H "Accept: $accept" -H "MCP-Protocol-Version: 2025-06-18" \
        -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' || true)"
    for t in resolve_music resolve_artist discover_music find_product resolve_game; do
        if ! echo "$tools" | grep -q "\"name\":\"$t\""; then
            echo "  FAIL  tools/list is missing $t"
            return 1
        fi
    done
    echo "  ok    MCP handshake: initialize + tools/list (5 tools)"
    return 0
}

main "$@"
