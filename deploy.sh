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

# CORS allowed origins (comma-separated). Leave empty for same-origin Web/API.
# Example for external frontends: CORS_ORIGINS=https://my-domain.com
CORS_ORIGINS=
EOF
        warn "已生成 .env，默认密码为 admin，请尽快修改！"
        warn "  SECRET_KEY 已自动生成安全随机值"
        warn "  编辑 .env: nano $SCRIPT_DIR/.env"
    else
        info ".env 已存在，跳过生成"
    fi
}

build_and_start() {
    if [ "${BUILD_LOCAL:-0}" = "1" ]; then
        info "本地构建应用镜像，并启动 AniBT-Speed 与 PeerBanHelper..."
        docker compose up -d --build --remove-orphans 2>&1
    else
        info "拉取预构建镜像，并启动 AniBT-Speed 与 PeerBanHelper..."
        docker compose pull peerbanhelper 2>&1 || warn "PeerBanHelper 镜像拉取失败，将在启动时重试"
        if ! docker compose pull app 2>&1; then
            warn "预构建镜像不可用，改为本地构建..."
            docker compose up -d --build --remove-orphans 2>&1
            info "等待服务启动..."
            sleep 5
            return
        fi
        docker compose up -d --remove-orphans 2>&1
    fi

    info "等待服务启动..."
    sleep 5
}

verify_services() {
    local all_ok=true

    if curl -sf http://127.0.0.1:6868/ >/dev/null 2>&1; then
        info "Web 面板           ✓ 运行中"
    else
        error "Web 面板           ✗ 未响应"
        all_ok=false
    fi

    if curl -sf http://127.0.0.1:6868/api/health >/dev/null 2>&1; then
        info "后端 API           ✓ 运行中"
    else
        error "后端 API           ✗ 未响应"
        all_ok=false
    fi

    local pbh_status
    pbh_status=$(docker inspect -f '{{.State.Status}}' anibt-speed-pbh 2>/dev/null || echo "not_found")
    if [ "$pbh_status" = "running" ]; then
        info "PeerBanHelper      ✓ 运行中"
    else
        warn "PeerBanHelper      △ 状态: $pbh_status (首次启动可能需要较长时间初始化)"
    fi

    if [ "$all_ok" = true ]; then
        echo ""
        info "部署完成！"
        echo ""
        echo "  Web 管理面板: http://127.0.0.1:6868"
        echo "  PeerBanHelper: http://127.0.0.1:9898"
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
        echo "  docker compose logs app"
        exit 1
    fi
}

main() {
    echo ""
    echo "========================================="
    echo "   AniBT-Speed 一键部署"
    echo "========================================="
    echo ""
    echo "  默认: 从 GHCR 拉取预构建镜像（推荐）"
    echo "  本地构建: BUILD_LOCAL=1 ./deploy.sh"
    echo "  部署形态: AniBT-Speed 单应用容器 + PeerBanHelper 附属容器"
    echo ""

    check_deps
    setup_env
    build_and_start
    verify_services
}

main "$@"
