# Kaggle Stage 1 GPU Pipeline

## Objective

Stage 1 should not run a CPU-heavy Docling conversion across every manual. The operationally correct approach is:

- extract native text for digital PDFs
- run OCR only on scanned or mixed pages
- preserve page images, OCR text, and bounding boxes
- shard the corpus if multiple Kaggle runs are used

## Recommended runtime split

### Local or Kaggle CPU

- classify all manuals as `digital`, `scanned`, or `mixed`
- skip `emanual1` and `emanual10` if they already completed

### Kaggle GPU

- run GPU OCR only on non-digital pages
- keep native text for digital pages
- write canonical markdown, OCR JSON, and manifests

## Kaggle notebook setup

Install the OCR dependencies inside a Kaggle notebook:

```bash
pip install --upgrade pypdf pypdfium2 paddleocr
```

If PaddleOCR is not already backed by a GPU-enabled runtime image, install the matching PaddlePaddle GPU package for the current Kaggle CUDA image before running the script.

## Commands

Run the full corpus except the already completed manuals:

```bash
python scripts/convert_manuals_kaggle.py \
  --device gpu \
  --disable-render-for-digital \
  --exclude emanual1 emanual10
```

Run only one shard out of two:

```bash
python scripts/convert_manuals_kaggle.py \
  --device gpu \
  --disable-render-for-digital \
  --exclude emanual1 emanual10 \
  --shard-count 2 \
  --shard-index 0
```

Run the second shard:

```bash
python scripts/convert_manuals_kaggle.py \
  --device gpu \
  --disable-render-for-digital \
  --exclude emanual1 emanual10 \
  --shard-count 2 \
  --shard-index 1
```

## Outputs

Per manual:

- `<manual>.native.md`
- `<manual>.ocr.json`
- `manifest.json`
- `page_images/*.png` for OCR pages, or all pages if rendering is enabled for digital documents

Run-level summary:

- `run_summary.json`

## Why this path is faster

- digital manuals do not go through OCR
- non-digital pages alone consume GPU time
- the corpus can be sharded across multiple Kaggle runs
- bounding boxes remain available for later citation and viewer highlighting
