#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo -e "  ${GREEN}✓${NC} $*"; }
fail() { FAIL=$((FAIL + 1)); echo -e "  ${RED}✗${NC} $*"; }
skip() { WARN=$((WARN + 1)); echo -e "  ${YELLOW}△${NC} $*"; }

section() { echo -e "\n${YELLOW}[$1]${NC}"; }

# ---------- Container status ----------
section "容器状态"

for svc in anibt-speed-backend anibt-speed-frontend anibt-speed-pbh; do
    status=$(docker inspect -f '{{.State.Status}}' "$svc" 2>/dev/null || echo "not_found")
    if [ "$status" = "running" ]; then
        pass "$svc: running"
    else
        fail "$svc: $status"
    fi
done

# ---------- Backend API ----------
section "后端 API"

# Health
if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    pass "GET /api/health"
else
    fail "GET /api/health"
fi

# Auth - login
source .env 2>/dev/null || true
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

TOKEN=$(curl -sf -X POST http://127.0.0.1:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"password\": \"${ADMIN_PASSWORD}\"}" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

if [ -n "$TOKEN" ]; then
    pass "POST /api/auth/login (JWT)"
else
    fail "POST /api/auth/login"
    echo "    后续认证测试将跳过"
fi

AUTH="Authorization: Bearer $TOKEN"

# Instances
if [ -n "$TOKEN" ]; then
    code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/instances -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        pass "GET /api/instances ($code)"
    else
        fail "GET /api/instances ($code)"
    fi
fi

# RSS feeds
if [ -n "$TOKEN" ]; then
    code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/rss -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        pass "GET /api/rss ($code)"
    else
        fail "GET /api/rss ($code)"
    fi
fi

# Settings
if [ -n "$TOKEN" ]; then
    for ep in space queue rate-limit telegram; do
        code=$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:8000/api/settings/$ep" -H "$AUTH" 2>/dev/null || echo "000")
        if [ "$code" = "200" ]; then
            pass "GET /api/settings/$ep ($code)"
        else
            fail "GET /api/settings/$ep ($code)"
        fi
    done
fi

# Stats
if [ -n "$TOKEN" ]; then
    code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/stats/traffic -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        pass "GET /api/stats/traffic ($code)"
    else
        fail "GET /api/stats/traffic ($code)"
    fi
fi

# Logs
if [ -n "$TOKEN" ]; then
    code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/stats/logs -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        pass "GET /api/stats/logs ($code)"
    else
        fail "GET /api/stats/logs ($code)"
    fi
fi

# ---------- Frontend ----------
section "前端"

code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:6868/ 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
    pass "GET / ($code)"
else
    fail "GET / ($code)"
fi

# API proxy
code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:6868/api/health 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
    pass "Nginx API 代理 /api/health ($code)"
else
    fail "Nginx API 代理 /api/health ($code)"
fi

# ---------- PeerBanHelper ----------
section "PeerBanHelper"

code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:9898/ 2>/dev/null || echo "000")
if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "301" ]; then
    pass "PeerBanHelper WebUI ($code)"
else
    skip "PeerBanHelper WebUI ($code) — 首次启动可能需要更长时间"
fi

# ---------- Timezone ----------
section "时区"

for svc in anibt-speed-backend anibt-speed-frontend; do
    tz=$(docker exec "$svc" date +%Z 2>/dev/null || echo "?")
    if [ "$tz" = "CST" ] || [ "$tz" = "Asia/Shanghai" ]; then
        pass "$svc: $tz"
    else
        fail "$svc: $tz (expected CST)"
    fi
done

# ---------- Data persistence ----------
section "数据持久化"

if [ -f "./backend/data/anibt_speed.db" ]; then
    size=$(du -h ./backend/data/anibt_speed.db | cut -f1)
    pass "SQLite 数据库存在 ($size)"
else
    skip "SQLite 数据库不存在 (首次启动将自动创建)"
fi

if [ -d "./peerbanhelper/data" ]; then
    pass "PeerBanHelper 数据目录存在"
else
    skip "PeerBanHelper 数据目录不存在"
fi

# ---------- Summary ----------
echo ""
echo "========================================="
echo -e "  测试结果: ${GREEN}${PASS} 通过${NC}  ${RED}${FAIL} 失败${NC}  ${YELLOW}${WARN} 跳过${NC}"
echo "========================================="
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}存在失败项，请检查日志：${NC}"
    echo "  docker compose logs backend"
    echo "  docker compose logs frontend"
    exit 1
else
    echo -e "${GREEN}所有核心服务运行正常！${NC}"
fi
