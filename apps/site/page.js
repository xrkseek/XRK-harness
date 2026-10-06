(function () {
  var zh = {
    slogan: ["向阳而生", "驭光而行"],
    lead: "桌面安装包由 AGT 提供。本页走 Cloudflare，目录实时拉取。",
    cli: "命令行",
    lang: "EN",
    wait: "尚未上传",
    win: "Windows x64",
    macArm: "macOS Apple Silicon",
    macIntel: "macOS Intel",
    get: "下载",
  };
  var en = {
    slogan: ["Born toward the sun.", "Steer the light."],
    lead: "Installers come from the AGT host. This Cloudflare page loads the catalog live.",
    cli: "CLI",
    lang: "中文",
    wait: "Not uploaded yet",
    win: "Windows x64",
    macArm: "macOS Apple Silicon",
    macIntel: "macOS Intel",
    get: "Download",
  };
  var labels = { "win-x64": "win", "mac-arm64": "macArm", "mac-x64": "macIntel" };
  var useZh = true;
  var cfg = window.XRK_HARNESS_SITE || {};
  var origin = (cfg.origin || "/api/harness").replace(/\/+$/, "");
  var downloadOrigin = (cfg.downloadOrigin || origin).replace(/\/+$/, "");

  function copy() {
    return useZh ? zh : en;
  }
  function abs(path, base) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return base + (path.charAt(0) === "/" ? path.replace(/^\/api\/harness/, "") : "/" + path);
  }
  function render(catalog) {
    var t = copy();
    var slogan = document.getElementById("slogan");
    slogan.replaceChildren();
    t.slogan.forEach(function (line) {
      var span = document.createElement("span");
      span.textContent = line;
      slogan.append(span);
    });
    document.getElementById("lead").textContent = t.lead;
    document.getElementById("cliLabel").textContent = t.cli;
    document.getElementById("lang").textContent = t.lang;
    if (catalog.cli) document.getElementById("cli").textContent = catalog.cli;
    var root = document.getElementById("downloads");
    root.replaceChildren();
    (catalog.products || []).forEach(function (row) {
      var wrap = document.createElement("article");
      wrap.className = "row";
      var text = document.createElement("div");
      var h = document.createElement("h2");
      h.textContent = t[labels[row.target] || ""] || row.target;
      var p = document.createElement("p");
      p.textContent = row.available
        ? [row.version, row.filename].filter(Boolean).join(" · ")
        : t.wait;
      text.append(h, p);
      var a = document.createElement("a");
      a.className = "btn";
      a.textContent = t.get;
      if (row.available && row.download) {
        a.href = abs(row.download, downloadOrigin);
      } else {
        a.href = "#";
        a.setAttribute("aria-disabled", "true");
      }
      wrap.append(text, a);
      root.append(wrap);
    });
  }
  function unwrap(json) {
    if (!json || json.success === false) throw new Error("catalog");
    if (json.data !== undefined) return json.data;
    var rest = Object.assign({}, json);
    delete rest.success;
    delete rest.message;
    return rest;
  }
  function boot() {
    fetch(origin + "/releases", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("live");
        return r.json();
      })
      .then(unwrap)
      .catch(function () {
        return fetch("./releases.json", { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error("fallback");
          return r.json();
        });
      })
      .then(render)
      .catch(function () {
        render({ products: [] });
      });
  }
  document.getElementById("lang").addEventListener("click", function () {
    useZh = !useZh;
    document.documentElement.lang = useZh ? "zh-CN" : "en";
    boot();
  });
  boot();
})();
