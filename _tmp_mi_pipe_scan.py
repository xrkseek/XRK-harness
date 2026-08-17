import zipfile, re, os

jar = r"C:\Users\sunflowerss\Documents\Downloads\PCL\新建文件夹\.minecraft\versions\FTB Skies 2 Aero\mods\Modern-Industrialization-2.5.6.jar"
out = r"C:\Users\sunflowerss\Desktop\XRKgrocery\XRK-harness\_tmp_mi"
os.makedirs(out, exist_ok=True)
z = zipfile.ZipFile(jar)

# lang keys
for n in z.namelist():
    if n.endswith("zh_cn.json") or n.endswith("en_us.json"):
        data = z.read(n).decode("utf-8", "replace")
        for k, v in re.findall(r'"([^"]+)"\s*:\s*"([^"]*)"', data):
            kl = k.lower()
            if any(x in kl for x in ("pipe", "wrench", "extract", "insert", "pull", "push", "connection", "network")):
                if "pipe" in kl or "wrench" in kl or "network" in kl:
                    print(f"LANG[{n.split('/')[-2] if '/' in n else n}] {k} = {v}")

print("--- classes ---")
for n in z.namelist():
    if not n.endswith(".class"):
        continue
    low = n.lower()
    if "pipe" in low and any(x in low for x in ("item", "wrench", "network", "connection", "endpoint", "transfer")):
        print(n)
