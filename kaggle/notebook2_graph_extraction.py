"""
Kaggle Notebook 2 — Graph Entity & Relationship Extraction
Run this notebook on Kaggle after Notebook 1.

Inputs:  chunks_with_embeddings.json (from Notebook 1)
Outputs: graph_nodes.json, graph_edges.json
"""

# ============================================================
# Cell 1: Install dependencies
# ============================================================
# !pip install groq tqdm

# ============================================================
# Cell 2: Imports & Config
# ============================================================
import json
import os
import re
from tqdm import tqdm

INPUT_DIR = "/kaggle/working/"       # or wherever Notebook 1 outputs are
OUTPUT_DIR = "/kaggle/working/"
GROQ_API_KEY = "YOUR_GROQ_KEY_HERE"  # Replace with actual key

# ============================================================
# Cell 3: Load chunks
# ============================================================
def load_chunks():
    with open(os.path.join(INPUT_DIR, "chunks_with_embeddings.json"), "r") as f:
        return json.load(f)

# ============================================================
# Cell 4: LLM-based Entity Extraction
# ============================================================
EXTRACTION_PROMPT = """You are an expert at extracting structured entities from chemical plant documentation.

From the text below, extract entities and relationships in JSON format.

Entity types: Equipment, Chemical, Procedure, Step, Hazard, Role, SafetyControl
Relationship types: USES_EQUIPMENT, INVOLVES_CHEMICAL, HAS_STEP, HAS_HAZARD, PERFORMED_BY, REQUIRES_PPE, PREREQUISITE_OF

Return JSON with:
{
  "entities": [{"id": "unique-id", "type": "EntityType", "name": "...", "properties": {...}}],
  "relationships": [{"source_id": "...", "target_id": "...", "type": "RelType", "properties": {...}}]
}

TEXT:
---
{text}
---

DOC_CODE: {doc_code}
PAGE: {page_number}

Return ONLY valid JSON, no other text."""

def extract_graph_from_chunk(chunk, client):
    """Use Groq LLM to extract entities and relationships from a chunk."""
    prompt = EXTRACTION_PROMPT.format(
        text=chunk["chunk_text"],
        doc_code=chunk.get("doc_code", "unknown"),
        page_number=chunk.get("page_number", 0),
    )
    
    try:
        response = client.chat.completions.create(
            model="llama3-70b-8192",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2000,
        )
        content = response.choices[0].message.content.strip()
        
        # Parse JSON from response
        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"Error: {e}")
    
    return {"entities": [], "relationships": []}

# ============================================================
# Cell 5: Deduplicate entities
# ============================================================
def deduplicate_entities(all_entities):
    """Merge duplicate entities by name+type."""
    seen = {}
    unique = []
    for ent in all_entities:
        key = f"{ent['type']}:{ent['name'].lower().strip()}"
        if key not in seen:
            seen[key] = ent
            unique.append(ent)
        else:
            # Merge properties
            existing = seen[key]
            if "properties" in ent and "properties" in existing:
                existing["properties"].update(ent.get("properties", {}))
    return unique

# ============================================================
# Cell 6: Main Pipeline
# ============================================================
def run_graph_extraction():
    from groq import Groq
    
    client = Groq(api_key=GROQ_API_KEY)
    chunks = load_chunks()
    
    all_entities = []
    all_relationships = []
    
    # Process every 3rd chunk to reduce API calls (adjust as needed)
    sample_chunks = chunks[::3]
    print(f"Processing {len(sample_chunks)} chunks for graph extraction...")
    
    for chunk in tqdm(sample_chunks, desc="Extracting"):
        result = extract_graph_from_chunk(chunk, client)
        
        for ent in result.get("entities", []):
            ent["source_doc_code"] = chunk.get("doc_code")
            ent["source_page"] = chunk.get("page_number")
        
        all_entities.extend(result.get("entities", []))
        all_relationships.extend(result.get("relationships", []))
    
    # Deduplicate
    unique_entities = deduplicate_entities(all_entities)
    print(f"Extracted {len(unique_entities)} unique entities, {len(all_relationships)} relationships")
    
    # Save outputs
    with open(os.path.join(OUTPUT_DIR, "graph_nodes.json"), "w") as f:
        json.dump(unique_entities, f, indent=2)
    
    with open(os.path.join(OUTPUT_DIR, "graph_edges.json"), "w") as f:
        json.dump(all_relationships, f, indent=2)
    
    print("Graph extraction complete!")

# ============================================================
# Cell 7: Execute
# ============================================================
if __name__ == "__main__":
    run_graph_extraction()
