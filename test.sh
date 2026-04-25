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

status=$(docker inspect -f '{{.State.Status}}' anibt-speed 2>/dev/null || echo "not_found")
if [ "$status" = "running" ]; then
    pass "anibt-speed: running"
else
    fail "anibt-speed: $status"
fi

pbh_status=$(docker inspect -f '{{.State.Status}}' anibt-speed-pbh 2>/dev/null || echo "not_found")
if [ "$pbh_status" = "running" ]; then
    pass "anibt-speed-pbh: running"
else
    skip "anibt-speed-pbh: $pbh_status (首次启动可能需要更长时间)"
fi

# ---------- Port exposure ----------
section "端口"

app_ports=$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}' anibt-speed 2>/dev/null || echo "")
if [ -n "$app_ports" ]; then
    pass "应用暴露端口: $app_ports"
else
    fail "应用端口映射未检测到"
fi

pbh_ports=$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}' anibt-speed-pbh 2>/dev/null || echo "")
if [ -n "$pbh_ports" ]; then
    pass "PeerBanHelper 暴露端口: $pbh_ports"
else
    skip "PeerBanHelper 端口映射未检测到"
fi

# ---------- Web UI ----------
section "Web 面板（单一对外端口 6868）"

code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:6868/ 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
    pass "GET / ($code)"
else
    fail "GET / ($code)"
fi

code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:6868/dashboard 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
    pass "SPA fallback /dashboard ($code)"
else
    fail "SPA fallback /dashboard ($code)"
fi

# ---------- Backend API ----------
section "后端 API（同容器）"

# Health
code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:6868/api/health 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
    pass "GET /api/health ($code)"
else
    fail "GET /api/health ($code)"
fi

# Auth - login
source .env 2>/dev/null || true
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

TOKEN=$(curl -sf -X POST http://127.0.0.1:6868/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"password\": \"${ADMIN_PASSWORD}\"}" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

if [ -n "$TOKEN" ]; then
    pass "POST /api/auth/login (JWT)"
else
    fail "POST /api/auth/login"
    echo "    后续认证测试将跳过"
fi

AUTH="Authorization: Bearer $TOKEN"

if [ -n "$TOKEN" ]; then
    for ep in instances rss; do
        code=$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:6868/api/$ep" -H "$AUTH" 2>/dev/null || echo "000")
        if [ "$code" = "200" ]; then
            pass "GET /api/$ep ($code)"
        else
            fail "GET /api/$ep ($code)"
        fi
    done

    for ep in space queue rate-limit telegram; do
        code=$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:6868/api/settings/$ep" -H "$AUTH" 2>/dev/null || echo "000")
        if [ "$code" = "200" ]; then
            pass "GET /api/settings/$ep ($code)"
        else
            fail "GET /api/settings/$ep ($code)"
        fi
    done

    code=$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:6868/api/stats/traffic" -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        pass "GET /api/stats/traffic ($code)"
    else
        fail "GET /api/stats/traffic ($code)"
    fi

    code=$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:6868/api/stats/logs" -H "$AUTH" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        pass "GET /api/stats/logs ($code)"
    else
        fail "GET /api/stats/logs ($code)"
    fi
fi

# ---------- Backend not accessible directly ----------
section "端口隔离验证"

if curl -sf --connect-timeout 2 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    fail "旧后端 8000 端口不应从主机直接访问"
else
    pass "旧后端 8000 端口未暴露"
fi

# ---------- PeerBanHelper ----------
section "PeerBanHelper"

code=$(curl -sf -o /dev/null -w '%{http_code}' --connect-timeout 3 http://127.0.0.1:9898/ 2>/dev/null || echo "000")
if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "301" ]; then
    pass "PeerBanHelper WebUI ($code)"
else
    skip "PeerBanHelper WebUI ($code) — 首次启动可能需要更长时间"
fi

# ---------- Timezone ----------
section "时区"

tz=$(docker exec anibt-speed date +%Z 2>/dev/null || echo "?")
if [ "$tz" = "CST" ] || [ "$tz" = "Asia/Shanghai" ]; then
    pass "anibt-speed: $tz"
else
    fail "anibt-speed: $tz (expected CST)"
fi

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
    echo "  docker compose logs app"
    exit 1
else
    echo -e "${GREEN}所有核心服务运行正常！${NC}"
fi
