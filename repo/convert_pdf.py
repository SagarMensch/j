import fitz  # PyMuPDF
from rapidocr_onnxruntime import RapidOCR

ocr = RapidOCR()

pdf_path = r"C:\Users\sagar\Downloads\jubilantingrevia\BRD_for_SOP.pdf"
md_path = r"C:\Users\sagar\Downloads\jubilantingrevia\BRD_for_SOP.md"

doc = fitz.open(pdf_path)
extracted_markdown = []

print(f"Opened PDF: {pdf_path} ({len(doc)} pages)")
print("Starting extraction via RapidOCR (Local OCR, No API)...")

for i in range(len(doc)):
    page = doc[i]
    print(f"Processing Page {i+1}...")
    
    # Get image of page (high resolution for better OCR)
    pix = page.get_pixmap(dpi=200)
    img_bytes = pix.tobytes("png")
    
    # Run OCR on the image bytes
    result, _ = ocr(img_bytes)
    
    page_text = ""
    if result:
        # result is a list of tuples: (box, text, score)
        for line in result:
            text = line[1]
            page_text += text + "\n"
            
    extracted_markdown.append(f"<!-- Page {i+1} -->\n{page_text}\n")

# Save the final markdown
with open(md_path, "w", encoding="utf-8") as f:
    f.write("\n---\n".join(extracted_markdown))

print(f"\nDone! Extracted {len(extracted_markdown)} pages. Saved to {md_path}")
