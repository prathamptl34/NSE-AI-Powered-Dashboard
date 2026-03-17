from SmartApi import SmartConnect

def probe():
    try:
        # Inspect the class directly
        methods = [m for m in dir(SmartConnect) if not m.startswith("_")]
        print(f"METHODS: {methods}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    probe()
