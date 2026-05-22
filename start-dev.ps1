Write-Host "🚀 TheCarPool Carpooling Platform — Developer Workspace Bootstrapper" -ForegroundColor Orange
Write-Host "=================================================================" -ForegroundColor DarkGray

# 1. Start Docker Containers
Write-Host "📦 Starting Spatial Database & Cache containers (docker-compose)..." -ForegroundColor Yellow
docker-compose up -d

# 2. Start Gateway API
Write-Host "🟢 Launching Node.js Fastify Gateway on http://localhost:5000..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd thecarpool-backend; npm run dev"

# 3. Start AI Engine
Write-Host "🔵 Launching Python FastAPI AI Voice Engine on http://localhost:8000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd thecarpool-ai; .\venv\Scripts\activate; python app/main.py"

# 4. Start Expo Mobile App
Write-Host "📱 Launching Expo Mobile Client..." -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd thecarpool-mobile; npm start"

Write-Host "✓ All services dispatched in background shell instances." -ForegroundColor Green
Write-Host "  - Gateway: http://localhost:5000" -ForegroundColor DarkGray
Write-Host "  - AI Engine: http://localhost:8000" -ForegroundColor DarkGray
Write-Host "  - Expo Client: http://localhost:8081 (Metro Bundler)" -ForegroundColor DarkGray
