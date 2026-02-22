#!/bin/bash
# ============================================
#  🚀 Trading Pro Analyzer — Démarrage rapide
# ============================================

echo "🥇 Démarrage du Trading Pro Analyzer..."
echo ""

cd "$(dirname "$0")"

# Kill any existing processes on our ports
lsof -ti:8080 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

# Start backend server in background
echo "📡 Lancement du serveur backend (port 8080)..."
node server.js &
BACKEND_PID=$!
sleep 2

# Start Vite frontend dev server in background
echo "🖥️  Lancement du frontend (port 5173)..."
npx vite --host &
FRONTEND_PID=$!
sleep 2

echo ""
echo "✅ Tout est prêt !"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Ouvre ton navigateur :"
echo "   👉 http://localhost:5173/"
echo ""
echo "📡 Backend API : http://localhost:8080"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Pour arrêter : appuie sur Ctrl+C"

# Wait and handle clean shutdown
trap "echo ''; echo '🛑 Arrêt...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
