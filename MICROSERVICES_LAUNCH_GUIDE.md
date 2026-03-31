# Microservices Launch Guide

## 1. Install dependencies

```powershell
cd C:\Users\ratho\Downloads\jubilantingrevia
py -3.12 -m pip install -r backend\requirements.txt
py -3.12 -m pip install -r microservices\requirements.txt
```

## 2. Ensure real data is seeded

```powershell
py -3.12 scripts\seed_product_data_stage2.py
```

## 3. Launch all services (PowerShell)

```powershell
cd C:\Users\sagar\Downloads\jubilantingrevia
.\microservices\run_all_services.ps1
```

This starts:
- identity-service `127.0.0.1:8101`
- knowledge-service `127.0.0.1:8102`
- training-service `127.0.0.1:8103`
- assessment-service `127.0.0.1:8104`
- analytics-service `127.0.0.1:8105`
- voice-service `127.0.0.1:8106`
- api-gateway `127.0.0.1:8000`

## 4. Open UI

`http://127.0.0.1:8000`

## 5. Health checks

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health | ConvertTo-Json -Depth 6
Invoke-RestMethod http://127.0.0.1:8101/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8102/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8103/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8104/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8105/health | ConvertTo-Json -Depth 4
Invoke-RestMethod http://127.0.0.1:8106/health | ConvertTo-Json -Depth 4
```

## 6. Prefect orchestration

```powershell
cd C:\Users\ratho\Downloads\jubilantingrevia
py -3.12 orchestration\prefect_stage_pipeline.py
```
