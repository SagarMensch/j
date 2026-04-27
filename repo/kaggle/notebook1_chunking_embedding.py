"""
Kaggle Notebook 1 — PDF Chunking & Embedding Pipeline
Run this notebook on Kaggle with GPU (T4) enabled.

Inputs:  PDF files in /kaggle/input/jubilant-sops/
Outputs: chunks_with_embeddings.json, bounding_boxes.json
"""

# ============================================================
# Cell 1: Install dependencies
# ============================================================
# !pip install pymupdf sentence-transformers tqdm

# ============================================================
# Cell 2: Imports
# ============================================================
import fitz  # PyMuPDF
import json
import os
import re
from tqdm import tqdm

# ============================================================
# Cell 3: Configuration
# ============================================================
INPUT_DIR = "/kaggle/input/jubilant-sops/"
OUTPUT_DIR = "/kaggle/working/"
CHUNK_SIZE = 400      # tokens (approx)
CHUNK_OVERLAP = 50    # tokens overlap between chunks
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"  # 384-dim

# ============================================================
# Cell 4: PDF Text + BBox Extraction
# ============================================================
def extract_pages(pdf_path):
    """Extract text blocks with bounding boxes from each page."""
    doc = fitz.open(pdf_path)
    pages = []
    for page_num, page in enumerate(doc, 1):
        pw, ph = page.rect.width, page.rect.height
        blocks = page.get_text("blocks")
        page_blocks = []
        for b in blocks:
            x0, y0, x1, y1, text, block_no, block_type = b
            if block_type != 0 or not text.strip():
                continue
            page_blocks.append({
                "text": text.strip(),
                "bbox": {
                    "x0": round(x0 / pw, 4),
                    "y0": round(y0 / ph, 4),
                    "x1": round(x1 / pw, 4),
                    "y1": round(y1 / ph, 4),
                },
            })
        pages.append({"page_number": page_num, "blocks": page_blocks})
    doc.close()
    return pages

# ============================================================
# Cell 5: Text Chunking (sliding window)
# ============================================================
def chunk_text(pages, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split page text into overlapping chunks with bounding box info."""
    chunks = []
    chunk_idx = 0
    
    for page in pages:
        page_text = " ".join([b["text"] for b in page["blocks"]])
        words = page_text.split()
        
        if len(words) == 0:
            continue
        
        # Detect section title (first line heuristic)
        section_title = None
        if page["blocks"]:
            first_line = page["blocks"][0]["text"]
            if len(first_line.split()) <= 10 and not first_line.endswith("."):
                section_title = first_line
        
        # Sliding window chunks
        i = 0
        while i < len(words):
            chunk_words = words[i : i + chunk_size]
            chunk_text_str = " ".join(chunk_words)
            
            # Approximate bounding box from page blocks
            bbox = page["blocks"][0]["bbox"] if page["blocks"] else {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
            
            chunks.append({
                "chunk_index": chunk_idx,
                "chunk_text": chunk_text_str,
                "page_number": page["page_number"],
                "section_title": section_title,
                "token_count": len(chunk_words),
                "bbox_x0": bbox["x0"],
                "bbox_y0": bbox["y0"],
                "bbox_x1": bbox["x1"],
                "bbox_y1": bbox["y1"],
            })
            chunk_idx += 1
            i += chunk_size - overlap
    
    return chunks

# ============================================================
# Cell 6: Generate Embeddings
# ============================================================
def generate_embeddings(chunks, model_name=MODEL_NAME):
    """Generate 384-dim embeddings using MiniLM-L6-v2."""
    from sentence_transformers import SentenceTransformer
    
    model = SentenceTransformer(model_name)
    texts = [c["chunk_text"] for c in chunks]
    
    print(f"Generating embeddings for {len(texts)} chunks...")
    embeddings = model.encode(texts, batch_size=32, show_progress_bar=True)
    
    for i, chunk in enumerate(chunks):
        chunk["embedding"] = embeddings[i].tolist()
    
    return chunks

# ============================================================
# Cell 7: Main Pipeline
# ============================================================
def run_pipeline():
    all_chunks = []
    all_bboxes = []
    
    pdf_files = [f for f in os.listdir(INPUT_DIR) if f.endswith(".pdf")]
    print(f"Found {len(pdf_files)} PDF files")
    
    for pdf_file in tqdm(pdf_files, desc="Processing PDFs"):
        pdf_path = os.path.join(INPUT_DIR, pdf_file)
        doc_code = os.path.splitext(pdf_file)[0]
        
        # Extract pages
        pages = extract_pages(pdf_path)
        
        # Chunk
        chunks = chunk_text(pages)
        
        # Add doc_code to each chunk
        for c in chunks:
            c["doc_code"] = doc_code
        
        # Collect bboxes
        for page in pages:
            for block in page["blocks"]:
                all_bboxes.append({
                    "doc_code": doc_code,
                    "page_number": page["page_number"],
                    **block["bbox"],
                    "text_preview": block["text"][:100],
                })
        
        all_chunks.extend(chunks)
    
    # Generate embeddings
    all_chunks = generate_embeddings(all_chunks)
    
    # Save outputs
    with open(os.path.join(OUTPUT_DIR, "chunks_with_embeddings.json"), "w") as f:
        json.dump(all_chunks, f, indent=2)
    
    with open(os.path.join(OUTPUT_DIR, "bounding_boxes.json"), "w") as f:
        json.dump(all_bboxes, f, indent=2)
    
    print(f"Done! {len(all_chunks)} chunks, {len(all_bboxes)} bounding boxes")

# ============================================================
# Cell 8: Execute
# ============================================================
if __name__ == "__main__":
    run_pipeline()
