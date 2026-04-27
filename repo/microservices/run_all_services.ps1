$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "[1/6] Starting identity-service on :8101"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo`"; py -3.12 -m uvicorn microservices.identity_service.app:app --host 127.0.0.1 --port 8101"

Write-Host "[2/6] Starting knowledge-service on :8102"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo`"; py -3.12 -m uvicorn microservices.knowledge_service.app:app --host 127.0.0.1 --port 8102"

Write-Host "[3/6] Starting training-service on :8103"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo`"; py -3.12 -m uvicorn microservices.training_service.app:app --host 127.0.0.1 --port 8103"

Write-Host "[4/6] Starting assessment-service on :8104"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo`"; py -3.12 -m uvicorn microservices.assessment_service.app:app --host 127.0.0.1 --port 8104"

Write-Host "[5/6] Starting analytics-service on :8105"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo`"; py -3.12 -m uvicorn microservices.analytics_service.app:app --host 127.0.0.1 --port 8105"

Write-Host "[6/6] Starting voice-service on :8106"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$repo`"; py -3.12 -m uvicorn microservices.voice_service.app:app --host 127.0.0.1 --port 8106"

Write-Host "[gateway] Starting API gateway on :8000"
py -3.12 -m uvicorn microservices.api_gateway.app:app --host 127.0.0.1 --port 8000
