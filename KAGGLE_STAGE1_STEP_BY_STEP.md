# Kaggle Stage 1 Step-by-Step Runbook

## Objective

Run Stage 1 extraction in a way that finishes quickly and preserves the right downstream substrate for:

- canonical chunks
- MiniLM embeddings
- BM25 indexing
- graph extraction into Neo4j
- evidence-backed citations and bounding boxes

This runbook uses the GPU-oriented extractor at [scripts/convert_manuals_kaggle.py](/C:/Users/sagar/Downloads/jubilantingrevia/scripts/convert_manuals_kaggle.py).

## What this pipeline does

The pipeline does not send every PDF through a slow universal conversion path.

Instead it follows this operating model:

1. inspect each PDF page
2. classify each page as `digital`, `scanned`, or `mixed`
3. keep native text for digital pages
4. run OCR only for non-digital pages
5. preserve page images for evidence and future viewer highlighting
6. write canonical artifacts and a manifest per manual

## Files already completed

These two manuals should be skipped:

- `emanual1`
- `emanual10`

## Step 1. Prepare the repo for Kaggle

Upload or clone the full project into Kaggle so the notebook or terminal can access:

- `equipment_manuals/`
- `scripts/convert_manuals_kaggle.py`
- `backend/app/models/extraction.py`

Recommended Kaggle working path:

```text
/kaggle/working/jubilantingrevia
```

## Step 2. Enable GPU in Kaggle

In the Kaggle notebook:

1. open notebook settings
2. enable `GPU`
3. save the runtime change

## Step 3. Install Python dependencies

Run:

```bash
pip install --upgrade pypdf pypdfium2 paddleocr
```

Important:

- if `paddleocr` does not use CUDA automatically, install the matching GPU-enabled `paddlepaddle-gpu` package for the Kaggle runtime
- this depends on the CUDA image Kaggle is currently using

## Step 4. Verify folder paths

Confirm these exist inside Kaggle:

```text
/kaggle/working/jubilantingrevia/scripts/convert_manuals_kaggle.py
/kaggle/working/jubilantingrevia/equipment_manuals
```

## Step 5. Run the extraction

Run the full remaining corpus:

```bash
python /kaggle/working/jubilantingrevia/scripts/convert_manuals_kaggle.py \
  --input-dir /kaggle/working/jubilantingrevia/equipment_manuals \
  --output-dir /kaggle/working/jubilantingrevia/stage1_outputs/kaggle_manuals \
  --device gpu \
  --disable-render-for-digital \
  --exclude emanual1 emanual10
```

## Step 6. Optional: split the workload into two runs

If you want to reduce single-run wall-clock time, shard the corpus.

First shard:

```bash
python /kaggle/working/jubilantingrevia/scripts/convert_manuals_kaggle.py \
  --input-dir /kaggle/working/jubilantingrevia/equipment_manuals \
  --output-dir /kaggle/working/jubilantingrevia/stage1_outputs/kaggle_manuals \
  --device gpu \
  --disable-render-for-digital \
  --exclude emanual1 emanual10 \
  --shard-count 2 \
  --shard-index 0
```

Second shard:

```bash
python /kaggle/working/jubilantingrevia/scripts/convert_manuals_kaggle.py \
  --input-dir /kaggle/working/jubilantingrevia/equipment_manuals \
  --output-dir /kaggle/working/jubilantingrevia/stage1_outputs/kaggle_manuals \
  --device gpu \
  --disable-render-for-digital \
  --exclude emanual1 emanual10 \
  --shard-count 2 \
  --shard-index 1
```

## Step 7. Understand the outputs

For each manual, the pipeline writes:

- `<manual>.native.md`
- `<manual>.ocr.json`
- `manifest.json`
- `page_images/*.png`

It also writes:

- `run_summary.json`

Recommended output folder:

```text
/kaggle/working/jubilantingrevia/stage1_outputs/kaggle_manuals
```

## Step 8. Check whether the run is healthy

Healthy signals:

- `run_summary.json` exists
- each processed manual has a `manifest.json`
- digital manuals finish quickly
- scanned/mixed manuals have `ocr_used=true` on non-digital pages
- page images exist for OCR pages

## Step 9. What to inspect in a manifest

Check:

- `classification`
- `page_count`
- `total_text_chars`
- `pages[].ocr_used`
- `pages[].ocr_confidence`
- `pages[].blocks`
- `artifacts`

If a manual has:

- low text quality
- empty OCR blocks
- obviously broken output

mark it for a later deep-pass or alternate extraction route.

## Step 10. What happens after extraction

Stage 1 does not stop at extraction. The next steps are:

1. normalize raw outputs into canonical blocks
2. remove duplicated or noisy segments
3. create retrieval-grade chunks
4. generate MiniLM embeddings
5. build BM25 index
6. extract entities and relations for Neo4j
7. load canonical records into Supabase

## Step 11. What not to do

Do not:

- run the old Docling-heavy CPU pipeline across all manuals for first pass
- embed raw markdown directly without normalization
- skip evidence preservation
- treat OCR text as trusted without quality review

## Step 12. Recommended execution order

1. run the Kaggle extractor
2. review `run_summary.json`
3. inspect 3-5 manifests manually
4. mark problematic manuals
5. start normalization and chunking
6. generate MiniLM embeddings
7. build BM25
8. move into graph extraction and retrieval

## Notebook option

If you prefer Kaggle notebook execution rather than terminal-only execution, use:

- [notebooks/convert_manuals_kaggle.ipynb](/C:/Users/sagar/Downloads/jubilantingrevia/notebooks/convert_manuals_kaggle.ipynb)
