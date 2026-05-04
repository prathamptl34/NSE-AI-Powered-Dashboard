import json
import os

SCRIP_MASTER_PATH = r'c:\Users\prath\OneDrive\Documents\gainer-looser\gainer-looser\gainer-looser\backend\OpenAPIScripMaster_large.bak'

def find_indices():
    if not os.path.exists(SCRIP_MASTER_PATH):
        print("Scrip master not found.")
        return

    with open(SCRIP_MASTER_PATH, 'r') as f:
        data = json.load(f)
        
    indices = [
        "NIFTY 50", "NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY METAL", 
        "NIFTY PHARMA", "NIFTY FMCG", "NIFTY REALTY", "NIFTY PSU BANK",
        "NIFTY FINANCIAL SERVICES", "NIFTY HEALTHCARE", "NIFTY INFRA",
        "NIFTY CONSUMER DURABLES", "NIFTY OIL & GAS", "NIFTY PRIVATE BANK",
        "NIFTY MIDCAP SELECT", "NIFTY SERVICES", "NIFTY COMMODITIES",
        "NIFTY MNC", "NIFTY DEFENCE", "NIFTY CAPITAL MARKETS",
        "SENSEX", "BSE BANKEX", "BSE IT", "BSE AUTO", "BSE METAL",
        "BSE OIL & GAS", "BSE FMCG", "BSE REALTY", "BSE PSU", "BSE POWER",
        "BSE HEALTHCARE", "BSE CONSUMER DURABLES", "BSE INFRA", "BANKNIFTY"
    ]
    
    found = {}
    for item in data:
        # Indices are sometimes in exch_seg 'NSE' or 'BSE' but might have different labels
        name = item.get('name', '').upper()
        symbol = item.get('symbol', '').upper()
        
        # Check for common index token patterns (like 999... or 260...)
        token = item.get('token', '')
        
        for idx in indices:
            clean_idx = idx.replace(" ", "").upper()
            if clean_idx == name or clean_idx == symbol or idx == name or idx == symbol:
                if idx not in found:
                    found[idx] = []
                found[idx].append(item)
            elif (idx in name or idx in symbol) and len(name) < 20: # avoid options
                if 'CE' not in symbol and 'PE' not in symbol:
                     if idx not in found:
                        found[idx] = []
                     found[idx].append(item)
                    
    with open('found_indices_v2.json', 'w') as out:
        json.dump(found, out, indent=2)
    print(f"Found {len(found)} indices. Results saved to found_indices_v2.json")

if __name__ == "__main__":
    find_indices()
