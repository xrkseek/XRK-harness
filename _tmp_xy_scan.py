import zipfile, os, re, sys

base = None
for root, dirs, files in os.walk(r"C:\Users\sunflowerss\Documents\Downloads\PCL"):
    if root.endswith(os.path.join("versions", "FTB Skies 2 Aero", "mods")) or root.replace("\\","/").endswith("FTB Skies 2 Aero/mods"):
        for f in files:
            if f.startswith("xycraft_machines") and f.endswith(".jar"):
                base = os.path.join(root, f)
                break
    if base:
        break

print("JAR", base)
z = zipfile.ZipFile(base)
out = r"C:\Users\sunflowerss\Desktop\XRKgrocery\XRK-harness\_tmp_xycraft"
os.makedirs(out, exist_ok=True)

# list extractor related
for n in z.namelist():
    low = n.lower()
    if "extract" in low and (n.endswith(".class") or n.endswith(".json") or n.endswith(".lang")):
        print(n)

# lang
for n in z.namelist():
    if n.endswith("zh_cn.json") or n.endswith("en_us.json"):
        data = z.read(n).decode("utf-8", "replace")
        for k, v in re.findall(r'"([^"]+)"\s*:\s*"([^"]*)"', data):
            if "extract" in k.lower() or "提取" in v:
                print(f"LANG {k} = {v}")
