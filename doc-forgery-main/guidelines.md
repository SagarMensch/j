# AI IDE Build Prompt: Document Forgery Backend From Existing `.pth`

## Critical Truth

Treat the downloaded `.pth` file as the **segmentation checkpoint only**.

Do **not** assume the checkpoint contains separate trained models for:
- ELA
- SRM
- Noiseprint
- OCR anomaly
- pHash
- DINO-ViT

Those techniques must be implemented in backend code as explicit preprocessing, scoring, and visualization modules. The `.pth` is the pixel-level tamper mask model. The other metrics and heatmaps are separate derived signals.

## What To Build

Build a complete Python backend that lets me upload a PDF or image document and get back:

1. A final verdict:
- `CLEAN`
- `SUSPICIOUS`
- `CONFIRMED_FORGERY`

2. A numeric forensic risk score in `[0, 1]`.

3. Per-engine metrics for:
- `ela_score`
- `srm_score`
- `noiseprint_score`
- `dino_vit_score`
- `ocr_anomaly_score`
- `phash_score`
- `segmentation_score`

4. Multi-page support for PDFs.

5. Visual artifacts for frontend display:
- original page image
- binary mask from the `.pth` model
- mask overlay on original
- ELA heatmap
- SRM heatmap
- Noiseprint heatmap
- DINO anomaly heatmap
- combined forensic heatmap
- bounding boxes / highlighted regions for suspected tampering

6. Structured OCR anomaly results:
- amount mismatch
- duplicate reference number
- suspicious keywords
- invalid / implausible dates

7. Duplicate detection information:
- computed MD5
- computed pHash
- nearest prior match if present
- hamming distance
- duplicate status: `NO_MATCH | NEAR_DUPLICATE | EXACT_DUPLICATE`

8. A clean JSON response contract so my frontend can render everything without extra backend changes.

## Required Stack

Use:
- Python 3.11
- FastAPI
- Uvicorn
- Pydantic v2
- PyTorch
- segmentation-models-pytorch
- OpenCV
- Pillow
- NumPy
- imagehash
- PyMuPDF for PDF page rendering
- PaddleOCR if feasible, otherwise EasyOCR as fallback
- SQLite for local metadata storage
- local filesystem storage for uploaded files and generated artifacts

Do not add Redis, Celery, Supabase, Neo4j, or cloud dependencies in the first version unless they are behind clean interfaces and optional. I want a working local backend first.

## Architecture

Create a clean project structure like this:

```text
backend/
  app/
    main.py
    core/
      config.py
      logging.py
      model_loader.py
    api/
      routes_health.py
      routes_model.py
      routes_analysis.py
      routes_artifacts.py
    schemas/
      requests.py
      responses.py
    services/
      storage_service.py
      pdf_service.py
      preprocess_service.py
      segmentation_service.py
      engine_service.py
      ocr_service.py
      duplicate_service.py
      artifact_service.py
      report_service.py
    utils/
      image_ops.py
      mask_ops.py
      hashing.py
      scoring.py
  data/
    uploads/
    outputs/
    artifacts/
    db/
  requirements.txt
  .env.example
  README.md
  Dockerfile
```

## Model Loading Requirements

Implement the segmentation model loader so it:

1. Accepts a configurable path to the `.pth`.
2. Reconstructs the model architecture used for training.
3. First tries:
- `smp.Unet`
- `encoder_name="efficientnet-b4"`
- `in_channels=12`
- `classes=1`

4. If state dict keys do not match, automatically try:
- `efficientnet-b3`

5. Fails with a clear error message if neither architecture matches.

6. Supports CPU and CUDA.

7. Exposes a `/api/v1/model/info` endpoint that returns:
- checkpoint path
- selected encoder
- input channels
- device
- model parameter count
- model loaded status

## Input Pipeline

For each uploaded document:

1. If input is PDF:
- render every page to RGB image
- preserve page order
- keep page index metadata

2. If input is image:
- treat as single page document

3. For every page build the exact 12-channel tensor:
- channels 0-2: RGB
- channels 3-5: noise residual
- channels 6-8: ELA
- channels 9-11: DCT

4. Use the same normalization logic as training.

5. Resize to the model input size expected by the checkpoint.

6. Keep both:
- original full-resolution page
- resized inference page

The backend must store both because the frontend should display original pages while overlays must align back to original coordinates.

## Engine Implementation Requirements

Implement these engines as separate services:

### 1. ELA
- recompress to JPEG quality 90
- compute absolute difference map
- produce score from high-error regions
- save ELA heatmap PNG

### 2. SRM
- apply 30 high-pass kernels on grayscale image
- aggregate residual energy
- produce score and SRM heatmap PNG

### 3. Noiseprint
- implement a lightweight residual-consistency approximation if no pretrained noiseprint weights are available
- produce normalized residual map
- produce inconsistency score
- save heatmap PNG

### 4. DINO-ViT
- use a pretrained DINO or DINOv2 timm model when available
- otherwise degrade gracefully with a documented fallback
- compute patch anomaly map
- save heatmap PNG

### 5. OCR Anomaly
- extract text per page
- combine page text into document text
- detect:
  - amount mismatch
  - duplicate reference codes
  - suspicious keywords
  - invalid dates
- return a detailed anomaly list
- compute weighted OCR anomaly score

### 6. pHash
- compute document-level pHash
- compute MD5
- compare against all previously analyzed documents stored locally
- return nearest match and duplicate classification

## Segmentation Output Requirements

Run the `.pth` model page by page and generate:

1. Probability map
2. Binary mask using configurable threshold
3. Overlay image on original page
4. Connected components / region extraction
5. Bounding boxes for tampered areas
6. Per-region metrics:
- `region_id`
- `page_index`
- `x`
- `y`
- `width`
- `height`
- `area_px`
- `mean_mask_score`
- `max_mask_score`

Also create:
- a raw grayscale mask PNG
- a colored overlay PNG
- a contour-highlighted PNG

## Final Scoring Logic

Implement a configurable weighted ensemble:

- ELA: `0.20`
- SRM: `0.20`
- Noiseprint: `0.20`
- DINO-ViT: `0.15`
- OCR anomaly: `0.15`
- pHash: `0.10`

Also include `segmentation_score` in the API output, but keep the final forensic risk score based on the six explicit engines unless configured otherwise.

Verdict thresholds:
- score `< 0.40` => `CLEAN`
- score `>= 0.40` and `< 0.85` => `SUSPICIOUS`
- score `>= 0.85` => `CONFIRMED_FORGERY`

Make these weights and thresholds configurable in a settings file.

## API Endpoints

Build these endpoints:

### `GET /api/v1/health`
Return simple service health.

### `GET /api/v1/model/info`
Return model metadata and load status.

### `POST /api/v1/analyze`
Accept multipart upload:
- file
- optional document_type
- optional submitter_id

Behavior:
- save original upload
- analyze all pages
- generate artifacts
- save metadata
- return analysis result JSON

### `GET /api/v1/analyze/{analysis_id}`
Return previously computed analysis JSON.

### `GET /api/v1/analyze`
Return paginated history of analyses.

### `GET /api/v1/artifacts/{analysis_id}/{filename}`
Serve generated artifact images.

### `DELETE /api/v1/analyze/{analysis_id}`
Optional cleanup endpoint for local development.

## Response Schema

The main analysis response must look roughly like this:

```json
{
  "analysis_id": "uuid",
  "filename": "invoice.pdf",
  "document_type": "invoice",
  "page_count": 3,
  "device": "cuda",
  "verdict": "SUSPICIOUS",
  "forensic_risk_score": 0.67,
  "engine_scores": {
    "ela_score": 0.62,
    "srm_score": 0.58,
    "noiseprint_score": 0.71,
    "dino_vit_score": 0.54,
    "ocr_anomaly_score": 0.40,
    "phash_score": 0.10,
    "segmentation_score": 0.83
  },
  "ocr_anomalies": [
    {
      "type": "AMOUNT_MISMATCH",
      "description": "Line items do not match total",
      "page_index": 1
    }
  ],
  "duplicate_check": {
    "md5_hash": "string",
    "phash": "string",
    "duplicate_status": "NO_MATCH",
    "nearest_match_analysis_id": null,
    "hamming_distance": null
  },
  "pages": [
    {
      "page_index": 1,
      "width": 2480,
      "height": 3508,
      "artifacts": {
        "original_url": "/api/v1/artifacts/uuid/page_1_original.png",
        "mask_url": "/api/v1/artifacts/uuid/page_1_mask.png",
        "overlay_url": "/api/v1/artifacts/uuid/page_1_overlay.png",
        "ela_heatmap_url": "/api/v1/artifacts/uuid/page_1_ela.png",
        "srm_heatmap_url": "/api/v1/artifacts/uuid/page_1_srm.png",
        "noiseprint_heatmap_url": "/api/v1/artifacts/uuid/page_1_noiseprint.png",
        "dino_heatmap_url": "/api/v1/artifacts/uuid/page_1_dino.png",
        "combined_heatmap_url": "/api/v1/artifacts/uuid/page_1_combined.png",
        "contours_url": "/api/v1/artifacts/uuid/page_1_contours.png"
      },
      "tampered_regions": [
        {
          "region_id": "page1_region1",
          "x": 420,
          "y": 610,
          "width": 310,
          "height": 90,
          "area_px": 27900,
          "mean_mask_score": 0.81,
          "max_mask_score": 0.97
        }
      ]
    }
  ],
  "processing_time_ms": 1842,
  "created_at": "timestamp"
}
```

## Frontend Contract Requirements

Design the backend so the frontend can build:

1. A document viewer with page selector
2. Original page view
3. Mask overlay toggle
4. Tabs for:
- original
- overlay
- ELA
- SRM
- Noiseprint
- DINO
- combined view

5. A table/card panel for:
- final verdict
- forensic risk score
- engine scores
- OCR anomalies
- duplicate check info
- tampered region list

The backend must return stable URLs for artifacts, not just temporary in-memory images.

## Storage Requirements

Store:
- original uploads
- per-page rendered images
- per-page artifact images
- analysis JSON
- hashes and duplicate index data

Use SQLite tables for:
- analyses
- pages
- regions
- duplicate fingerprints
- OCR anomalies

## Implementation Notes

- Use UUIDs for `analysis_id`.
- Add CORS support for local frontend development.
- Make artifact generation deterministic and file-name stable.
- Keep all heavy logic inside service classes, not route handlers.
- Add structured logging around model loading, upload, page rendering, inference, artifact generation, and response serialization.
- Add graceful CPU fallback if CUDA is unavailable.
- Add clear error messages when model load fails or file type is unsupported.

## Non-Negotiable Behaviors

1. The original uploaded document must always be viewable in the response flow.
2. Every page must include tamper visualization artifacts.
3. Every engine score must be returned even if some are fallback approximations.
4. If OCR extraction fails, return `ocr_anomaly_score = 0.0` and record an OCR warning instead of crashing.
5. If no prior document exists for pHash comparison, return `duplicate_status = NO_MATCH`.
6. If the checkpoint architecture mismatches B4, automatically try B3 before failing.

## Deliverables

Produce:

1. Working FastAPI backend code
2. Requirements file
3. `.env.example`
4. Dockerfile
5. README with:
- setup
- how to point to the `.pth`
- how to run locally
- how to call `/api/v1/analyze`
- sample frontend integration notes

6. Basic tests for:
- model loading
- PDF rendering
- tensor preprocessing shape
- single-page inference
- multi-page response schema

## Final Instruction To The AI IDE

Build the full backend now. Do not stop at scaffolding. Implement real working endpoints, real artifact generation, real checkpoint loading, and a complete JSON response contract for frontend consumption. If a component cannot be production-grade without additional pretrained assets, implement the strongest working fallback and clearly document it in the README without blocking the end-to-end system.
