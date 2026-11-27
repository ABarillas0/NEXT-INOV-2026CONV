#!/usr/bin/env bash
# Levanta Convivio ALMO 2026.
#   ./run.sh            -> Docker (build + up en segundo plano)
#   ./run.sh local      -> Node directo (npm install + npm start)
#   ./run.sh logs       -> ver logs del contenedor
#   ./run.sh stop       -> detener el contenedor
#   ./run.sh restart    -> reconstruir y reiniciar
# Variables opcionales: ADMIN_PIN=1234  HOST_PORT=3000
set -euo pipefail
cd "$(dirname "$0")"

export ADMIN_PIN="${ADMIN_PIN:-2026}"
export HOST_PORT="${HOST_PORT:-3000}"

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@";
  elif command -v docker-compose >/dev/null 2>&1; then docker-compose "$@";
  else echo "❌ No encontré docker compose. Instala Docker o usa: ./run.sh local"; exit 1; fi
}

ip_local() {
  (hostname -I 2>/dev/null | awk '{print $1}') || true
  ipconfig getifaddr en0 2>/dev/null || true
}

case "${1:-docker}" in
  local)
    command -v node >/dev/null || { echo "❌ Necesitas Node.js 18+"; exit 1; }
    npm install --no-audit --no-fund
    exec npm start
    ;;
  logs)    compose logs -f --tail=100 ;;
  stop)    compose down ;;
  restart) compose up -d --build --force-recreate ;;
  docker|up)
    command -v docker >/dev/null || { echo "❌ Docker no está instalado. Usa: ./run.sh local"; exit 1; }
    mkdir -p data
    # El contenedor corre como usuario 'node' (uid 1000): necesita poder escribir en ./data
    chmod 777 data 2>/dev/null || true
    compose up -d --build
    IP="$(ip_local | head -n1)"
    echo ""
    echo "🏁 Convivio ALMO 2026 arriba"
    echo "   Local:  http://localhost:${HOST_PORT}"
    [ -n "$IP" ] && echo "   Red:    http://${IP}:${HOST_PORT}"
    echo "   Admin:  /admin  (PIN ${ADMIN_PIN})"
    echo "   Logs:   ./run.sh logs     Detener: ./run.sh stop"
    ;;
  *) echo "Uso: ./run.sh [local|logs|stop|restart]"; exit 1 ;;
esac
