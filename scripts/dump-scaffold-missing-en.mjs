import fs from "node:fs";

const miss = JSON.parse(fs.readFileSync("scripts/.locale-ja-missing.json", "utf8"));
const map = JSON.parse(fs.readFileSync("scripts/locale-ja-en-map.json", "utf8"));
const uniq = [...new Set(miss.map((m) => m.en))].filter((e) => !(e in map)).sort();
fs.writeFileSync("scripts/.locale-en-still-missing.json", JSON.stringify(uniq, null, 2));
console.log(uniq.length);
