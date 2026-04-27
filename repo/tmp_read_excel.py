import pandas as pd
import json
import sys

file_path = r"C:\Users\sagar\Downloads\Jubilant_Ingrevia_Pricing_with_Justifications.xlsx"
try:
    df_dict = pd.read_excel(file_path, sheet_name=None)
    output = {}
    for sheet_name, df in df_dict.items():
        output[sheet_name] = df.fillna("").to_dict(orient="records")
    print(json.dumps(output, indent=2))
except Exception as e:
    print(f"Error: {e}")
