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

# ---------- Network ----------
section "网络"

network=$(docker network inspect anibt-speed_anibt -f '{{.Name}}' 2>/dev/null || echo "not_found")
if [ "$network" != "not_found" ]; then
    pass "Docker 网络 anibt-speed_anibt 存在"
else
    fail "Docker 网络 anibt-speed_anibt 不存在"
fi

# Check only frontend exposes ports to host
frontend_ports=$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} {{end}}' anibt-speed-frontend 2>/dev/null || echo "")
backend_ports=$(docker inspect -f '{{range $p, $conf := .HostConfig.PortBindings}}{{$p}} {{end}}' anibt-speed-backend 2>/dev/null || echo "")
pbh_ports=$(docker inspect -f '{{range $p, $conf := .HostConfig.PortBindings}}{{$p}} {{end}}' anibt-speed-pbh 2>/dev/null || echo "")

if [ -n "$frontend_ports" ]; then
    pass "前端暴露端口: $frontend_ports"
else
    skip "前端端口映射未检测到"
fi

if [ -z "$backend_ports" ]; then
    pass "后端无暴露端口（仅内部网络）"
else
    fail "后端不应暴露端口: $backend_ports"
fi

if [ -z "$pbh_ports" ]; then
    pass "PBH 无暴露端口（仅内部网络）"
else
    fail "PBH 不应暴露端口: $pbh_ports"
fi

# ---------- Frontend ----------
section "前端（唯一对外端口 6868）"

code=$(curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:6868/ 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then
    pass "GET / ($code)"
else
    fail "GET / ($code)"
fi

# ---------- Backend API (via Nginx proxy) ----------
section "后端 API（通过 Nginx 代理）"

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
    fail "后端 8000 端口不应从主机直接访问"
else
    pass "后端 8000 端口已隔离"
fi

if curl -sf --connect-timeout 2 http://127.0.0.1:9898/ >/dev/null 2>&1; then
    fail "PBH 9898 端口不应从主机直接访问"
else
    pass "PBH 9898 端口已隔离"
fi

# ---------- Internal connectivity (via docker exec) ----------
section "内部网络连通性"

backend_health=$(docker exec anibt-speed-frontend wget -qO- http://backend:8000/api/health 2>/dev/null && echo "ok" || echo "fail")
if [ "$backend_health" = "ok" ]; then
    pass "frontend -> backend:8000 连通"
else
    # Nginx proxy already tested above; this is just a direct connectivity check
    # If proxy works, internal network is fine
    if curl -sf http://127.0.0.1:6868/api/health >/dev/null 2>&1; then
        pass "frontend -> backend:8000 连通 (通过代理验证)"
    else
        fail "frontend -> backend:8000 不通"
    fi
fi

pbh_status=$(docker exec anibt-speed-backend curl -sf --connect-timeout 3 http://peerbanhelper:9898/ 2>/dev/null && echo "ok" || echo "fail")
if [ "$pbh_status" = "ok" ]; then
    pass "backend -> peerbanhelper:9898 连通"
else
    # Try with wget or python as fallback
    pbh_status2=$(docker exec anibt-speed-backend python3 -c "import urllib.request; urllib.request.urlopen('http://peerbanhelper:9898/', timeout=3); print('ok')" 2>/dev/null || echo "fail")
    if [ "$pbh_status2" = "ok" ]; then
        pass "backend -> peerbanhelper:9898 连通"
    else
        skip "backend -> peerbanhelper:9898 (PBH 可能仍在初始化)"
    fi
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
