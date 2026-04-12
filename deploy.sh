#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

check_deps() {
    local missing=()
    command -v docker   >/dev/null 2>&1 || missing+=(docker)
    command -v docker   >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || missing+=("docker-compose")
    command -v git      >/dev/null 2>&1 || missing+=(git)

    if [ ${#missing[@]} -gt 0 ]; then
        error "缺少必要工具: ${missing[*]}"
        exit 1
    fi
    info "依赖检查通过"
}

setup_env() {
    if [ ! -f .env ]; then
        info "首次部署，生成 .env 文件..."
        local secret_key
        secret_key=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)

        cat > .env <<EOF
# === AniBT-Speed Configuration ===
# Only minimal secrets here. All other config (qBT instances,
# Telegram, policies) is managed via the Web UI.

SECRET_KEY=${secret_key}
ADMIN_PASSWORD=admin
EOF
        warn "已生成 .env，默认密码为 admin，请尽快修改！"
        warn "  编辑 .env: nano $SCRIPT_DIR/.env"
    else
        info ".env 已存在，跳过生成"
    fi
}

build_and_start() {
    info "构建并启动所有服务..."
    docker compose up -d --build 2>&1

    info "等待服务启动..."
    sleep 5
}

verify_services() {
    local all_ok=true

    # Backend
    if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
        info "后端 (FastAPI)     ✓ 运行中"
    else
        error "后端 (FastAPI)     ✗ 未响应"
        all_ok=false
    fi

    # Frontend
    if curl -sf http://127.0.0.1:6868/ >/dev/null 2>&1; then
        info "前端 (Nginx)       ✓ 运行中"
    else
        error "前端 (Nginx)       ✗ 未响应"
        all_ok=false
    fi

    # PeerBanHelper
    if curl -sf http://127.0.0.1:9898/ >/dev/null 2>&1; then
        info "PeerBanHelper      ✓ 运行中"
    else
        warn "PeerBanHelper      △ 未响应 (首次启动需要较长时间初始化)"
    fi

    if [ "$all_ok" = true ]; then
        echo ""
        info "部署完成！"
        echo ""
        echo "  Web 管理面板: http://127.0.0.1:6868"
        echo "  默认密码见 .env 中的 ADMIN_PASSWORD"
        echo ""
        echo "  下一步："
        echo "    1. 登录面板，添加 qBittorrent 实例"
        echo "    2. 添加 RSS 订阅源"
        echo "    3. 配置 Telegram 通知（可选）"
        echo ""
    else
        echo ""
        error "部分服务未能正常启动，请检查日志："
        echo "  docker compose logs backend"
        echo "  docker compose logs frontend"
        exit 1
    fi
}

main() {
    echo ""
    echo "========================================="
    echo "   AniBT-Speed 一键部署"
    echo "========================================="
    echo ""

    check_deps
    setup_env
    build_and_start
    verify_services
}

main "$@"
