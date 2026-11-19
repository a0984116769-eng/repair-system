(function () {
  "use strict";

  var FAV_KEY = "travel-guide-favorites";

  function $(id) { return document.getElementById(id); }

  // 建立元素；文字一律用 textContent，避免使用者或 AI 的內容被當成 HTML
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function showMessage(node, text, kind) {
    node.textContent = text;
    node.className = "message " + kind;
    node.hidden = false;
  }
  function hideMessage(node) { node.hidden = true; node.textContent = ""; }

  function describeError(error) {
    var msg = (error && error.message) || "";
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "連線失敗，請檢查網路後再試一次。";
    if (error && error.code === "42501") return "沒有權限執行這個動作，請確認資料表權限已設定。";
    if (error && error.code === "42P01") return "找不到資料表，請先執行 supabase/schema.sql。";
    if (error && error.code === "23514") return "資料格式不符合規定，請檢查各欄位內容。";
    if (error && error.code === "23503") return "這篇攻略已經不存在。";
    return "發生錯誤：" + (msg || "未知錯誤") + (error && error.code ? "（代碼 " + error.code + "）" : "");
  }

  var dateTime = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  // ---- 收藏（只存在這個瀏覽器） ----
  function loadFavs() {
    try {
      var v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }) : [];
    } catch (e) { return []; }
  }
  function saveFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* 無法儲存時忽略 */ }
  }
  var favs = loadFavs();
  function isFav(id) { return favs.indexOf(id) !== -1; }
  function toggleFav(id) {
    if (isFav(id)) favs = favs.filter(function (x) { return x !== id; });
    else favs = [id].concat(favs);
    saveFavs(favs);
  }

  // ---- 連線設定 ----
  var cfg = window.TRAVEL_CONFIG || {};
  var client = null;
  var setupMsg = $("setup-message");
  if (!(typeof cfg.supabaseUrl === "string" && /^https:\/\//.test(cfg.supabaseUrl) &&
        typeof cfg.supabaseKey === "string" && cfg.supabaseKey)) {
    showMessage(setupMsg, "尚未設定 Supabase：請在 config.js 填入專案網址與 publishable key。", "err");
  } else if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showMessage(setupMsg, "無法載入 Supabase 程式庫，請檢查網路連線後重新整理頁面。", "err");
  } else {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  var FN = cfg.generateFunction || "generate-guide";

  function guideName(g) {
    return g.city ? g.country + "・" + g.city : g.country;
  }

  // =====================================================================
  // 首頁：攻略清單
  // =====================================================================
  var listEl = $("guide-list");
  var listMsg = $("list-message");
  var filterText = $("filter-text");
  var refreshBtn = $("refresh-btn");
  var allGuides = [];

  function renderList() {
    listEl.textContent = "";
    var q = filterText.value.trim().toLowerCase();
    var rows = allGuides.filter(function (g) {
      if (!isFav(g.id)) return false; // 清單只保留收藏的攻略
      if (!q) return true;
      return (g.country + " " + (g.city || "")).toLowerCase().indexOf(q) !== -1;
    });
    if (!rows.length) {
      var text = q ? "找不到符合的收藏攻略。" : "還沒有收藏的攻略。在上方搜尋攻略後，按「☆ 收藏」就會保留在這裡。";
      listEl.appendChild(el("li", "empty", text));
      return;
    }
    rows.forEach(function (g) {
      var li = el("li");
      var a = el("a");
      a.href = "#/guide/" + encodeURIComponent(g.id);
      var badge = el("span", "g-badge", "🧳");
      badge.setAttribute("aria-hidden", "true");
      var text = el("span", "g-text");
      text.appendChild(el("span", "g-name", guideName(g)));
      text.appendChild(el("span", "g-sub", g.days + " 天・整理於 " + g.compiled_on));
      var chev = el("span", "g-chev", "›");
      chev.setAttribute("aria-hidden", "true");
      a.appendChild(badge);
      a.appendChild(text);
      a.appendChild(chev);
      li.appendChild(a);
      listEl.appendChild(li);
    });
  }

  function loadList() {
    if (!client) return;
    // 清單只保留收藏的攻略：沒有收藏就不必查詢
    if (!favs.length) {
      hideMessage(listMsg);
      allGuides = [];
      renderList();
      return;
    }
    refreshBtn.disabled = true;
    client
      .from("travel_guides")
      .select("id, created_at, country, city, days, compiled_on")
      .in("id", favs.slice(0, 200))
      .order("created_at", { ascending: false })
      .then(function (r) {
        if (r.error) { showMessage(listMsg, "無法載入攻略清單。" + describeError(r.error), "err"); return; }
        hideMessage(listMsg);
        allGuides = r.data || [];
        renderList();
      })
      .catch(function (e) { showMessage(listMsg, "無法載入攻略清單。" + describeError(e), "err"); })
      .finally(function () { refreshBtn.disabled = false; });
  }

  filterText.addEventListener("input", renderList);
  refreshBtn.addEventListener("click", loadList);

  // ---- 分享／轉移收藏：把收藏的攻略編號放進連結與 QR Code，另一台裝置打開就能加入 ----
  var MAX_SHARE = 40;
  var favDialog = $("fav-dialog");
  var favReturn = null;
  function favLink() {
    return location.href.split("#")[0] + "#/import/" + favs.slice(0, MAX_SHARE).join(",");
  }
  function drawQr(text) {
    var box = $("fav-qr");
    box.textContent = "";
    if (typeof window.qrcode !== "function") {
      box.appendChild(el("p", "list-hint", "無法產生 QR Code，請改用「複製連結」。"));
      return;
    }
    var qr = window.qrcode(0, "L");
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }
  function openFavDialog() {
    var body = $("fav-share-body");
    var sub = $("fav-dialog-sub");
    if (!favs.length) {
      sub.textContent = "還沒有收藏的攻略。先在攻略頁按「☆ 收藏」，再回來分享。";
      body.hidden = true;
    } else {
      var n = Math.min(favs.length, MAX_SHARE);
      sub.textContent = "共 " + n + " 篇收藏" + (favs.length > MAX_SHARE ? "（一次最多 " + MAX_SHARE + " 篇）" : "") +
        "。換手機、或分享給同行的人都可以用。";
      body.hidden = false;
      var link = favLink();
      $("fav-link").value = link;
      drawQr(link);
      $("fav-share").hidden = typeof navigator.share !== "function";
    }
    favReturn = document.activeElement;
    favDialog.hidden = false;
    $("fav-dialog-close").focus();
  }
  function closeFavDialog() {
    if (favDialog.hidden) return;
    favDialog.hidden = true;
    if (favReturn && favReturn.focus) favReturn.focus();
  }
  $("share-favs").addEventListener("click", openFavDialog);
  Array.prototype.forEach.call(favDialog.querySelectorAll("[data-fav-close]"), function (n) {
    n.addEventListener("click", closeFavDialog);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !favDialog.hidden) closeFavDialog();
  });
  $("fav-copy").addEventListener("click", function () {
    var btn = $("fav-copy");
    var input = $("fav-link");
    function done(t) { btn.textContent = t; setTimeout(function () { btn.textContent = "📋 複製連結"; }, 1600); }
    function fallback() { input.focus(); input.select(); done("請按住連結複製"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(function () { done("✅ 已複製"); }, fallback);
    } else { fallback(); }
  });
  $("fav-share").addEventListener("click", function () {
    navigator.share({ title: "下一站：我的收藏攻略", text: "打開連結，按「加入收藏」就能看到這些攻略。", url: $("fav-link").value })
      .catch(function () { /* 使用者取消分享時不處理 */ });
  });

  // 打開收藏連結（#/import/編號,編號）時，詢問要不要加入
  var importBox = $("import-box");
  var importYes = $("import-yes");
  var importNo = $("import-no");
  var pendingImport = [];
  function leaveImport() {
    if (/^#\/import\//.test(location.hash)) history.replaceState(null, "", location.pathname + location.search + "#/");
  }
  function importMessage(title, closeText) {
    $("import-title").textContent = title;
    importYes.hidden = true;
    importNo.textContent = closeText || "關閉";
  }
  function showImport(raw) {
    var seen = {};
    var ids = raw.split(",").filter(function (x) {
      if (!/^[0-9a-f-]{36}$/i.test(x) || seen[x]) return false;
      seen[x] = true;
      return true;
    }).slice(0, MAX_SHARE);
    favs = loadFavs();
    var fresh = ids.filter(function (x) { return !isFav(x); });
    var list = $("import-list");
    list.textContent = "";
    pendingImport = [];
    importBox.hidden = false;
    if (!ids.length) { importMessage("這個收藏連結不正確，請重新複製一次。"); return; }
    if (!fresh.length) { importMessage("這些攻略都已經在你的收藏裡了。"); return; }
    importMessage("讀取攻略中…", "不用了");
    if (!client) return;
    client.from("travel_guides").select("id, country, city, days").in("id", fresh).then(function (r) {
      if (r.error || !Array.isArray(r.data)) { importMessage("無法讀取這些攻略。" + describeError(r.error)); return; }
      if (!r.data.length) { importMessage("找不到這些攻略，可能已經被刪除。"); return; }
      pendingImport = r.data.map(function (g) { return g.id; });
      r.data.forEach(function (g) { list.appendChild(el("li", null, "🧳 " + guideName(g) + "・" + g.days + " 天")); });
      $("import-title").textContent = "要把這 " + pendingImport.length + " 篇攻略加入收藏嗎？";
      importYes.textContent = "加入 " + pendingImport.length + " 篇收藏";
      importYes.hidden = false;
      importNo.textContent = "不用了";
    });
  }
  importYes.addEventListener("click", function () {
    var n = pendingImport.length;
    favs = loadFavs(); // 以裝置上最新的收藏為準（例如另一個分頁剛改過）
    favs = pendingImport.concat(favs.filter(function (x) { return pendingImport.indexOf(x) === -1; }));
    saveFavs(favs);
    pendingImport = [];
    $("import-list").textContent = "";
    importMessage("✅ 已加入 " + n + " 篇收藏。");
    leaveImport();
    loadList();
  });
  importNo.addEventListener("click", function () {
    importBox.hidden = true;
    pendingImport = [];
    leaveImport();
  });

  // =====================================================================
  // 首頁：請 AI 產生攻略
  // =====================================================================
  var genForm = $("gen-form");
  var genBtn = $("gen-btn");
  var genMsg = $("gen-message");

  function readFunctionError(error) {
    // 伺服器端函式回傳的錯誤訊息在 error.context（Response）裡
    if (error && error.context && typeof error.context.json === "function") {
      return error.context.json().then(function (body) {
        return (body && body.error) || describeError(error);
      }, function () { return describeError(error); });
    }
    return Promise.resolve(describeError(error));
  }

  // ---- 表單小工具：熱門目的地、天數加減、預算快選 ----
  var POPULAR = [
    ["🇯🇵", "日本"], ["🇰🇷", "韓國"], ["🇹🇭", "泰國"], ["🇻🇳", "越南"], ["🇸🇬", "新加坡"],
    ["🇮🇹", "義大利"], ["🇫🇷", "法國"], ["🇨🇭", "瑞士"], ["🇺🇸", "美國"], ["🇦🇺", "澳洲"],
  ];
  // ---- 國家、城市下拉選單 ----
  // 表單真正送出的值仍在 country、city 兩個文字欄位；下拉選單選「其他」時才顯示文字欄位讓人自己輸入
  var OTHER = "__other__";
  var PLACES = window.NEXTSTOP_PLACES || [];
  var countrySelect = $("g-country-select");
  var citySelect = $("g-city-select");
  var countryOther = $("g-country-other");
  var cityOther = $("g-city-other");

  function findCountry(name) {
    for (var i = 0; i < PLACES.length; i++) {
      for (var j = 0; j < PLACES[i].countries.length; j++) {
        if (PLACES[i].countries[j].name === name) return PLACES[i].countries[j];
      }
    }
    return null;
  }
  function option(value, text, disabled) {
    var o = el("option", null, text);
    o.value = value;
    if (disabled) o.disabled = true;
    return o;
  }

  countrySelect.appendChild(option("", "請選擇國家", true));
  PLACES.forEach(function (group) {
    var og = el("optgroup");
    og.label = group.region;
    group.countries.forEach(function (c) { og.appendChild(option(c.name, c.flag + " " + c.name)); });
    countrySelect.appendChild(og);
  });
  countrySelect.appendChild(option(OTHER, "✏️ 其他國家（自己輸入）"));

  function fillCities(country) {
    citySelect.textContent = "";
    citySelect.appendChild(option("", "不指定，推薦 5 個城市"));
    var c = findCountry(country);
    if (c) {
      var og = el("optgroup");
      og.label = "熱門城市";
      c.cities.forEach(function (name) { og.appendChild(option(name, name)); });
      citySelect.appendChild(og);
    }
    citySelect.appendChild(option(OTHER, "✏️ 其他城市（自己輸入）"));
  }

  // 依文字欄位的值，更新下拉選單的顯示
  function syncSelects() {
    var country = genForm.elements.country.value.trim();
    var city = genForm.elements.city.value.trim();
    var known = !!findCountry(country);
    countrySelect.value = known ? country : (country ? OTHER : "");
    if (!country) countrySelect.selectedIndex = 0;
    countryOther.hidden = known || !country;
    fillCities(known ? country : "");
    var cityKnown = known && findCountry(country).cities.indexOf(city) !== -1;
    citySelect.value = !city ? "" : (cityKnown ? city : OTHER);
    cityOther.hidden = !city || cityKnown;
  }

  countrySelect.addEventListener("change", function () {
    var v = countrySelect.value;
    genForm.elements.country.value = v === OTHER ? "" : v;
    genForm.elements.city.value = "";
    genForm.elements.country.setAttribute("aria-invalid", "false");
    countrySelect.setAttribute("aria-invalid", "false");
    fillCities(v === OTHER ? "" : v);
    citySelect.value = "";
    cityOther.hidden = true;
    countryOther.hidden = v !== OTHER;
    if (v === OTHER) genForm.elements.country.focus();
    syncPicks();
  });
  citySelect.addEventListener("change", function () {
    var v = citySelect.value;
    genForm.elements.city.value = v === OTHER ? "" : v;
    cityOther.hidden = v !== OTHER;
    if (v === OTHER) genForm.elements.city.focus();
  });

  var countryPicks = $("country-picks");
  POPULAR.forEach(function (p) {
    var b = el("button", null, p[0] + " " + p[1]);
    b.type = "button";
    b.addEventListener("click", function () {
      if (genForm.elements.country.value.trim() !== p[1]) genForm.elements.city.value = "";
      genForm.elements.country.value = p[1];
      genForm.elements.country.setAttribute("aria-invalid", "false");
      countrySelect.setAttribute("aria-invalid", "false");
      syncSelects();
      syncPicks();
    });
    countryPicks.appendChild(b);
  });

  Array.prototype.forEach.call(document.querySelectorAll(".step-btn"), function (b) {
    b.addEventListener("click", function () {
      var input = genForm.elements.days;
      var v = parseInt(input.value, 10);
      if (!Number.isInteger(v)) v = 5;
      input.value = Math.min(14, Math.max(1, v + Number(b.dataset.step)));
      syncPicks();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("#budget-picks button"), function (b) {
    b.addEventListener("click", function () {
      genForm.elements.budget.value = b.dataset.budget;
      syncPicks();
    });
  });

  // 目前的值跟哪個快選相同，就標示出來
  function syncPicks() {
    var country = genForm.elements.country.value.trim();
    Array.prototype.forEach.call(countryPicks.children, function (b, i) {
      b.setAttribute("aria-pressed", POPULAR[i][1] === country ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll("#budget-picks button"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.budget === String(genForm.elements.budget.value) ? "true" : "false");
    });
    var days = parseInt(genForm.elements.days.value, 10);
    document.querySelector('.step-btn[data-step="-1"]').disabled = days <= 1;
    document.querySelector('.step-btn[data-step="1"]').disabled = days >= 14;
  }
  ["country", "budget", "days"].forEach(function (k) { genForm.elements[k].addEventListener("input", syncPicks); });
  genForm.addEventListener("reset", function () { setTimeout(function () { syncSelects(); syncPicks(); }, 0); });
  syncSelects();
  syncPicks();

  // ---- 頁尾：旅行小提醒（每次開啟隨機一句） ----
  var TIPS = [
    "出發前確認護照效期，很多國家要求至少還有 6 個月。",
    "記得購買旅遊平安險與海外突發疾病險。",
    "把護照、機票拍照存一份在手機與雲端。",
    "出國前開通信用卡的海外交易與簡訊通知。",
    "查一下目的地的插座規格，帶對轉接頭。",
    "到外交部領事事務局網站登錄出國行程，緊急時找得到你。",
    "下載離線地圖，沒有網路也能找路。",
    "準備一點當地現金，小店和交通常常不能刷卡。",
    "行李秤重再出門，超重費比想像中貴。",
    "熱門景點和餐廳常要預約，出發前先訂好。",
  ];
  $("travel-tip").textContent = "💡 旅行小提醒：" + TIPS[Math.floor(Math.random() * TIPS.length)];

  // ---- 推薦城市 ----
  var suggestCard = $("suggest-card");
  var suggestList = $("suggest-list");

  function renderSuggestions(data) {
    var cities = Array.isArray(data.cities) ? data.cities : [];
    $("suggest-heading").textContent = (data.country || "") + "：推薦 " + cities.length + " 個城市";
    $("suggest-sub").textContent = "每個城市 " + data.days + " 天、每人每天約 NT$" +
      Number(data.budget).toLocaleString("zh-TW") + "。挑一個喜歡的，按「產生完整攻略」就會產生含路線圖、景點照片的攻略。";
    suggestList.textContent = "";
    cities.forEach(function (c, i) {
      if (!c || typeof c.city !== "string" || !c.city) return;
      var li = el("li", "suggest");
      var head = el("div", "suggest-head");
      head.appendChild(el("span", "suggest-num", String(i + 1)));
      var names = el("div", "suggest-names");
      names.appendChild(el("span", "suggest-city", c.city));
      if (c.city_local && c.city_local !== c.city) names.appendChild(el("span", "suggest-local", c.city_local));
      head.appendChild(names);
      li.appendChild(head);
      if (c.tagline) li.appendChild(el("p", "suggest-tagline", c.tagline));
      if (c.why) li.appendChild(el("p", "suggest-why", c.why));
      if (c.best_season) li.appendChild(el("p", "suggest-season", "🌤️ 最佳季節：" + c.best_season));
      var hl = Array.isArray(c.highlights) ? c.highlights.filter(function (h) { return typeof h === "string" && h; }) : [];
      if (hl.length) {
        var chips = el("ul", "chips");
        hl.forEach(function (h) { chips.appendChild(el("li", null, h)); });
        li.appendChild(chips);
      }
      var outline = Array.isArray(c.outline) ? c.outline : [];
      if (outline.length) {
        var det = el("details", "suggest-outline");
        det.appendChild(el("summary", null, "看 " + outline.length + " 天行程大綱"));
        var ol = el("ol");
        outline.forEach(function (d, k) {
          if (!d || typeof d.plan !== "string") return;
          var item = el("li");
          item.appendChild(el("strong", null, "第 " + (Number.isInteger(d.day) ? d.day : k + 1) + " 天："));
          item.appendChild(document.createTextNode(d.plan));
          ol.appendChild(item);
        });
        det.appendChild(ol);
        li.appendChild(det);
      }
      var btn = el("button", "suggest-btn", "產生「" + c.city + "」完整攻略");
      btn.type = "button";
      btn.addEventListener("click", function () {
        // 用這個城市重新送出表單
        genForm.elements.country.value = data.country || genForm.elements.country.value;
        genForm.elements.city.value = c.city;
        genForm.elements.days.value = data.days;
        genForm.elements.budget.value = data.budget;
        syncSelects();
        syncPicks();
        genForm.scrollIntoView({ behavior: "smooth", block: "start" });
        genForm.requestSubmit();
      });
      li.appendChild(btn);
      suggestList.appendChild(li);
    });
    suggestCard.hidden = !suggestList.childNodes.length;
    if (!suggestCard.hidden) suggestCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- 等待時的進度顯示 ----
  // 伺服器只在完成時回覆一次，所以步驟是依平常花的時間估計；完成時一律跳到 100%
  var genProgress = $("gen-progress");
  var gpFill = $("gp-fill");
  var gpSteps = $("gp-steps");
  var gpTime = $("gp-time");
  var gpTimer = null;
  var GP_PLANS = {
    guide: { tau: 14, typical: "15～40 秒", steps: [["🔎", "上網搜尋最新資料", 0], ["🤖", "AI 整理行程、餐廳和住宿", 3], ["📷", "找景點照片、存檔", 16]] },
    suggest: { tau: 8, typical: "10～20 秒", steps: [["🤖", "AI 挑選 5 個城市", 0], ["📝", "整理每個城市的行程大綱", 6]] },
  };
  function startProgress(kind) {
    var plan = GP_PLANS[kind];
    var t0 = Date.now();
    gpSteps.textContent = "";
    var items = plan.steps.map(function (st) {
      var li = el("li");
      var icon = el("span", "gp-icon", st[0]);
      icon.setAttribute("aria-hidden", "true");
      li.appendChild(icon);
      li.appendChild(el("span", "gp-label", st[1]));
      gpSteps.appendChild(li);
      return li;
    });
    function tick() {
      var sec = (Date.now() - t0) / 1000;
      var current = 0;
      plan.steps.forEach(function (st, i) { if (sec >= st[2]) current = i; });
      items.forEach(function (li, i) { li.className = i < current ? "done" : (i === current ? "active" : ""); });
      gpFill.style.width = (95 * (1 - Math.exp(-sec / plan.tau))).toFixed(1) + "%";
      gpTime.textContent = "已等待 " + Math.floor(sec) + " 秒（通常 " + plan.typical + "），請不要關閉頁面。";
    }
    clearInterval(gpTimer);
    hideMessage(genMsg);
    tick();
    gpTimer = setInterval(tick, 1000);
    genProgress.hidden = false;
  }
  function stopProgress(done) {
    clearInterval(gpTimer);
    gpTimer = null;
    if (!done) { genProgress.hidden = true; return; }
    Array.prototype.forEach.call(gpSteps.children, function (li) { li.className = "done"; });
    gpFill.style.width = "100%";
    gpTime.textContent = "完成！";
    setTimeout(function () { genProgress.hidden = true; }, 800);
  }

  genForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client) return;
    hideMessage(genMsg);

    var country = genForm.elements.country.value.trim();
    var city = genForm.elements.city.value.trim();
    var days = Number(genForm.elements.days.value);
    var budget = Number(genForm.elements.budget.value);
    var problems = [];
    var bad = {};
    if (!country) { problems.push("請填寫「國家」"); bad.country = true; }
    if (!Number.isInteger(days) || days < 1 || days > 14) { problems.push("天數必須是 1～14 的整數"); bad.days = true; }
    if (!Number.isInteger(budget) || budget < 0 || budget > 1000000) { problems.push("預算必須是 0～1,000,000 的整數"); bad.budget = true; }
    ["country", "days", "budget"].forEach(function (k) {
      genForm.elements[k].setAttribute("aria-invalid", bad[k] ? "true" : "false");
    });
    countrySelect.setAttribute("aria-invalid", bad.country ? "true" : "false");
    if (problems.length) {
      showMessage(genMsg, problems.join("；") + "。", "err");
      return;
    }

    genBtn.disabled = true;
    genBtn.textContent = city ? "AI 整理攻略中，請稍候…" : "AI 挑選城市中，請稍候…";
    startProgress(city ? "guide" : "suggest");

    client.functions
      .invoke(FN, { body: { country: country, city: city, days: days, budget: budget } })
      .then(function (r) {
        if (r.error) {
          stopProgress(false);
          return readFunctionError(r.error).then(function (text) {
            showMessage(genMsg, "產生失敗。" + text, "err");
          });
        }
        // 只輸入國家：顯示 5 個推薦城市
        if (r.data && r.data.mode === "suggest") {
          stopProgress(true);
          hideMessage(genMsg);
          renderSuggestions(r.data);
          return;
        }
        var id = r.data && r.data.id;
        if (!id) { stopProgress(false); showMessage(genMsg, "產生失敗：伺服器沒有回傳攻略編號。", "err"); return; }
        stopProgress(true);
        genForm.reset();
        hideMessage(genMsg);
        location.hash = "#/guide/" + encodeURIComponent(id);
      })
      .catch(function (e) { stopProgress(false); showMessage(genMsg, "產生失敗。" + describeError(e), "err"); })
      .finally(function () {
        genBtn.disabled = false;
        genBtn.textContent = "🔍 搜尋";
      });
  });

  // =====================================================================
  // 攻略內容
  // =====================================================================
  var detailMsg = $("detail-message");
  var guideCard = $("guide");
  var guideBody = $("guide-body");
  var favBtn = $("fav-btn");
  var commentsCard = $("comments-card");
  var reportCard = $("report-card");
  var currentId = null;

  var SECTION_ICONS = {
    "適合季節": "🌤️", "預算範圍": "💰", "每日行程與推薦路線": "🗺️", "交通方式": "🚆",
    "住宿區域建議": "🏨", "推薦住宿": "🛏️", "必吃美食": "🍜", "必去景點": "📍", "必買伴手禮": "🎁", "簽證與入境須知": "🛂",
    "注意事項": "⚠️", "請到官方網站查證": "🔗", "資料來源": "🔗",
  };

  function section(title, content) {
    if (content == null || content === "" || (Array.isArray(content) && !content.length)) return;
    var h = el("h3");
    if (SECTION_ICONS[title]) {
      var icon = el("span", "h-icon", SECTION_ICONS[title]);
      icon.setAttribute("aria-hidden", "true");
      h.appendChild(icon);
    }
    h.appendChild(document.createTextNode(title));
    guideBody.appendChild(h);
    if (typeof content === "string") guideBody.appendChild(el("p", null, content));
    else guideBody.appendChild(content);
  }

  function list(items, ordered) {
    var ul = el(ordered ? "ol" : "ul");
    items.forEach(function (t) { if (typeof t === "string" && t) ul.appendChild(el("li", null, t)); });
    return ul.childNodes.length ? ul : null;
  }

  function updateFavBtn() {
    var on = isFav(currentId);
    favBtn.textContent = on ? "★ 已收藏" : "☆ 收藏";
    favBtn.setAttribute("aria-pressed", on ? "true" : "false");
    favBtn.classList.toggle("on", on);
    $("fav-hint").textContent = on
      ? "已收藏，會保留在「我的收藏攻略」。"
      : "還沒收藏：攻略清單只保留收藏的攻略，按「☆ 收藏」才找得到這篇。";
  }

  // ---- 推薦行程路線圖 ----
  var maps = []; // 目前頁面上的地圖，換頁時要移除
  var pendingMaps = []; // 攻略卡片顯示後才能畫地圖（地圖需要知道容器大小）

  function clearMaps() {
    maps.forEach(function (m) { m.remove(); });
    maps = [];
    pendingMaps = [];
  }

  function validCoord(r) {
    return typeof r.lat === "number" && typeof r.lng === "number" &&
      isFinite(r.lat) && isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180;
  }

  // Google 地圖搜尋用的名稱：優先用當地語言名稱，再加上城市，避免找到同名的地方
  function mapQuery(r, g) {
    var name = typeof r.place_local === "string" && r.place_local ? r.place_local : r.place;
    var area = g.city || g.country || "";
    return area && name.indexOf(area) === -1 ? name + " " + area : name;
  }

  // 從上一個地點到這個地點的大眾運輸路線（Google 地圖）
  function directionsUrl(from, to, g) {
    return "https://www.google.com/maps/dir/?api=1&travelmode=transit&origin=" +
      encodeURIComponent(mapQuery(from, g)) + "&destination=" + encodeURIComponent(mapQuery(to, g));
  }

  function drawRouteMap(container, points, dayLabel) {
    if (!window.L) return false; // 地圖程式庫沒載入（例如離線）就不畫
    var map = L.map(container, {
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile, // 手機上單指滑動用來捲動頁面，用雙指縮放地圖
      tap: false,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    var latlngs = points.map(function (p) { return [p.lat, p.lng]; });
    L.polyline(latlngs, { color: "#0f6b74", weight: 4, opacity: 0.8 }).addTo(map);
    points.forEach(function (p) {
      var icon = L.divIcon({ className: "map-pin", html: String(p.num), iconSize: [28, 28], iconAnchor: [14, 14] });
      var marker = L.marker([p.lat, p.lng], { icon: icon, title: p.num + ". " + p.place }).addTo(map);
      var tip = document.createElement("span");
      tip.textContent = p.num + ". " + p.place; // 用 textContent，避免 AI 產生的文字被當成 HTML
      marker.bindTooltip(tip);
    });
    if (latlngs.length === 1) map.setView(latlngs[0], 14);
    else map.fitBounds(latlngs, { padding: [24, 24], maxZoom: 15 });
    container.setAttribute("aria-label", dayLabel + "路線圖");
    maps.push(map);
    return true;
  }

  // ---- 推薦住宿 ----
  // ---- 必買伴手禮：卡片列出品名、為什麼值得買、去哪買、價格與帶回台灣的注意事項 ----
  var GIFT_KINDS = { "食品": "gift-food", "酒類": "gift-drink", "工藝品": "gift-craft", "美妝保養": "gift-beauty", "文創": "gift-art" };
  function souvenirList(items, g) {
    var list = items.filter(function (x) { return x && typeof x.name === "string" && x.name; });
    if (!list.length) return null;
    var box = el("div");
    var ul = el("ul", "gift-list");
    list.forEach(function (x) {
      var li = el("li", "gift");
      var head = el("div", "eat-head");
      if (x.kind) head.appendChild(el("span", "eat-tag " + (GIFT_KINDS[x.kind] || "gift-art"), x.kind));
      li.appendChild(head);
      var name = el("div", "eat-name", x.name);
      if (x.name_local && x.name_local !== x.name) name.appendChild(el("span", "eat-local", x.name_local));
      li.appendChild(name);
      if (x.why) li.appendChild(el("p", "eat-intro", x.why));
      var dl = el("dl", "spot-info");
      [["🛍️", "哪裡買", x.where], ["💵", "價格", x.price], ["🧳", "帶回台灣", x.carry], ["💡", "小提醒", x.tips]].forEach(function (row) {
        if (typeof row[2] !== "string" || !row[2]) return;
        var item = el("div");
        var dt = el("dt");
        var ic = el("span", null, row[0] + " ");
        ic.setAttribute("aria-hidden", "true");
        dt.appendChild(ic);
        dt.appendChild(document.createTextNode(row[1]));
        item.appendChild(dt);
        item.appendChild(el("dd", null, row[2]));
        dl.appendChild(item);
      });
      if (dl.childNodes.length) li.appendChild(dl);
      if (typeof x.where === "string" && x.where) {
        var a = el("a", "eat-map", "在 Google 地圖查看店家 ›");
        a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(x.where + " " + (g.city || g.country || ""));
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var warn = el("p", "gift-note");
    var b = el("b", null, "帶回台灣前注意：");
    warn.appendChild(b);
    warn.appendChild(document.createTextNode(
      "肉類製品（例如肉乾、香腸、含肉的泡麵）不能帶回台灣，違者會被處高額罰鍰；新鮮水果、植物也不能隨意攜帶。" +
      "酒類與液體請放託運行李。出發前請到農業部動植物防疫檢疫署網站查最新規定。"));
    box.appendChild(warn);
    box.appendChild(el("p", "map-note", g.web_verified === true
      ? "伴手禮由 AI 依上網搜尋的資料推薦（整理日期 " + g.compiled_on + "），價格與店家可能變動，出發前請再確認。"
      : "伴手禮由 AI 依既有知識推薦，價格與店家可能變動或已歇業，出發前請再確認。"));
    return box;
  }

  function hotelList(items, g) {
    var list = items.filter(function (h) { return h && typeof h.name === "string" && h.name; });
    if (!list.length) return null;
    var box = el("div");
    var ul = el("ul", "hotel-list");
    list.forEach(function (h) {
      var li = el("li", "hotel");
      var head = el("div", "eat-head");
      var tierClass = h.tier === "高級" ? "tier-high" : h.tier === "中價" ? "tier-mid" : "tier-low";
      if (h.tier) head.appendChild(el("span", "eat-tag " + tierClass, h.tier));
      if (h.type) head.appendChild(el("span", "eat-meal", h.type));
      li.appendChild(head);
      var name = el("div", "eat-name", h.name);
      if (h.name_local && h.name_local !== h.name) name.appendChild(el("span", "eat-local", h.name_local));
      li.appendChild(name);
      if (h.why) li.appendChild(el("p", "eat-intro", h.why));
      var hl = Array.isArray(h.highlights) ? h.highlights.filter(function (x) { return typeof x === "string" && x; }) : [];
      if (hl.length) {
        var chips = el("ul", "chips");
        hl.forEach(function (x) { chips.appendChild(el("li", null, x)); });
        li.appendChild(chips);
      }
      var dl = el("dl", "spot-info");
      [["💵", "價格", h.price], ["📍", "區域", h.area], ["🚉", "交通", h.station], ["💡", "小提醒", h.tips]].forEach(function (row) {
        if (typeof row[2] !== "string" || !row[2]) return;
        var item = el("div");
        var dt = el("dt");
        var ic = el("span", null, row[0] + " ");
        ic.setAttribute("aria-hidden", "true");
        dt.appendChild(ic);
        dt.appendChild(document.createTextNode(row[1]));
        item.appendChild(dt);
        item.appendChild(el("dd", null, row[2]));
        dl.appendChild(item);
      });
      if (dl.childNodes.length) li.appendChild(dl);
      // 用 Google 地圖查位置、評價與最新房價
      var q = (h.name_local || h.name) + " " + (g.city || g.country || "");
      var a = el("a", "eat-map", "在 Google 地圖查看 ›");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(el("p", "map-note", g.web_verified === true
      ? "住宿由 AI 依上網搜尋的資料推薦（整理日期 " + g.compiled_on + "），價格會依季節與日期變動；訂房前請用 Google 地圖或訂房網站確認。"
      : "住宿由 AI 依既有知識推薦，價格會依季節與日期變動，也可能已停業或更名；訂房前請用 Google 地圖或訂房網站確認。"));
    return box;
  }

  // ---- 每天的推薦餐廳與小吃 ----
  function eatList(eats, g) {
    var box = el("div", "eats");
    box.appendChild(el("div", "route-title", "推薦餐廳與小吃"));
    var ul = el("ul", "eat-list");
    eats.forEach(function (e) {
      var kind = e.kind === "小吃" ? "小吃" : "餐廳";
      var li = el("li", "eat");
      li.dataset.kind = kind;
      var head = el("div", "eat-head");
      head.appendChild(el("span", "eat-tag " + (kind === "小吃" ? "eat-snack" : "eat-rest"), (kind === "小吃" ? "🥟 " : "🍴 ") + kind));
      if (e.meal) head.appendChild(el("span", "eat-meal", e.meal));
      li.appendChild(head);
      var name = el("div", "eat-name", e.name);
      if (e.name_local && e.name_local !== e.name) name.appendChild(el("span", "eat-local", e.name_local));
      li.appendChild(name);
      if (e.intro) li.appendChild(el("p", "eat-intro", e.intro));
      var dl = el("dl", "spot-info");
      [["🍜", "招牌", e.signature], ["🍽️", "類型", e.cuisine], ["💵", "價位", e.price], ["📍", "區域", e.area], ["🕒", "營業", e.hours]].forEach(function (row) {
        if (typeof row[2] !== "string" || !row[2]) return;
        var item = el("div");
        var dt = el("dt");
        var ic = el("span", null, row[0] + " ");
        ic.setAttribute("aria-hidden", "true");
        dt.appendChild(ic);
        dt.appendChild(document.createTextNode(row[1]));
        item.appendChild(dt);
        item.appendChild(el("dd", null, row[2]));
        dl.appendChild(item);
      });
      if (dl.childNodes.length) li.appendChild(dl);
      // 用 Google 地圖查最新的營業資訊與評價
      var q = (e.name_local || e.name) + " " + (g.city || g.country || "");
      var a = el("a", "eat-map", "在 Google 地圖查看 ›");
      a.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.appendChild(el("p", "map-note", g.web_verified === true
      ? "餐廳資訊由 AI 依上網搜尋的資料整理（整理日期 " + g.compiled_on + "），營業時間與價格仍可能變動，出發前請用 Google 地圖確認。"
      : "餐廳資訊由 AI 依既有知識整理，可能已歇業或變更，出發前請用 Google 地圖確認。"));
    return box;
  }

  // ---- 必去景點：照片、介紹與相關資訊 ----
  function httpsUrl(u, prefix) {
    return typeof u === "string" && u.indexOf(prefix) === 0 ? u : "";
  }

  function spotList(items) {
    var ul = el("ul", "spots");
    items.forEach(function (a) {
      // 舊攻略只有景點名稱（字串）
      if (typeof a === "string") {
        if (a) ul.appendChild(el("li", "spot spot-simple", a));
        return;
      }
      if (!a || typeof a.name !== "string" || !a.name) return;
      var li = el("li", "spot");

      var photo = a.photo || {};
      // 只顯示維基共享資源的照片
      var img = typeof photo.url === "string" && /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(photo.url) ? photo.url : "";
      var page = httpsUrl(photo.page_url, "https://") && /^https:\/\/[a-z-]+\.wikipedia\.org\//.test(photo.page_url) ? photo.page_url : "";
      if (img) {
        var fig = el("figure", "spot-photo");
        var im = el("img");
        im.src = img;
        im.alt = a.name;
        im.loading = "lazy";
        im.decoding = "async";
        im.referrerPolicy = "no-referrer";
        im.addEventListener("error", function () { fig.remove(); }); // 照片載入失敗就不顯示
        fig.appendChild(im);
        var cap = el("figcaption");
        cap.appendChild(document.createTextNode("照片："));
        if (page) {
          var capLink = el("a", null, "維基百科「" + (photo.page_title || a.name) + "」");
          capLink.href = page;
          capLink.target = "_blank";
          capLink.rel = "noopener noreferrer";
          cap.appendChild(capLink);
        } else {
          cap.appendChild(document.createTextNode("維基百科"));
        }
        fig.appendChild(cap);
        li.appendChild(fig);
      }

      var body = el("div", "spot-body");
      var h = el("h4", "spot-name", a.name);
      var local = [a.name_local, a.name_en].filter(function (x) {
        return typeof x === "string" && x && x !== a.name;
      });
      if (local.length) h.appendChild(el("span", "spot-local", local.join("・")));
      body.appendChild(h);
      if (a.intro) body.appendChild(el("p", "spot-intro", a.intro));

      var info = [["🕒", "開放時間", a.hours], ["🎫", "門票", a.ticket], ["⏱️", "建議停留", a.duration], ["💡", "小提醒", a.tips]];
      var dl = el("dl", "spot-info");
      info.forEach(function (row) {
        if (typeof row[2] !== "string" || !row[2]) return;
        var item = el("div");
        var dt = el("dt");
        var ic = el("span", null, row[0] + " ");
        ic.setAttribute("aria-hidden", "true");
        dt.appendChild(ic);
        dt.appendChild(document.createTextNode(row[1]));
        item.appendChild(dt);
        item.appendChild(el("dd", null, row[2]));
        dl.appendChild(item);
      });
      if (dl.childNodes.length) body.appendChild(dl);

      if (page) {
        var more = el("a", "spot-more", "在維基百科看更多 ›");
        more.href = page;
        more.target = "_blank";
        more.rel = "noopener noreferrer";
        body.appendChild(more);
      }
      li.appendChild(body);
      ul.appendChild(li);
    });
    return ul.childNodes.length ? ul : null;
  }

  function renderGuide(g) {
    $("guide-title").textContent = guideName(g);
    var asked = g.req_country + (g.req_city ? "・" + g.req_city : "") + "，" + g.req_days + " 天，每人每天約 NT$" +
      Number(g.req_budget_twd).toLocaleString("zh-TW");
    $("guide-meta").textContent =
      "建議 " + g.days + " 天・AI 整理日期 " + g.compiled_on + "・模型 " + g.model + "\n查詢條件：" + asked;
    $("guide-meta").style.whiteSpace = "pre-wrap";
    clearMaps();
    guideBody.textContent = "";

    // web_verified：AI 產生時是否有上網搜尋查證
    var verified = g.web_verified === true;
    $("guide-notice").textContent = verified
      ? "內容由 AI 上網搜尋後整理，可能有錯或過時。簽證與入境規定請以官方公告為準，出發前請再次確認。"
      : "本篇由 AI 依既有知識整理，未經上網查證。簽證、價格、交通與營業時間可能已經改變，出發前請到下方官方網站確認。";

    section("適合季節", g.season);
    section("預算範圍", g.budget);

    var days = Array.isArray(g.itinerary) ? g.itinerary : [];
    if (days.length) {
      var ol = el("ul", "plain-list days");
      days.forEach(function (d, i) {
        if (!d) return;
        var plan = typeof d.plan === "string" ? d.plan : "";
        var route = Array.isArray(d.route) ? d.route.filter(function (r) {
          return r && typeof r.place === "string" && r.place;
        }) : [];
        var eats = Array.isArray(d.eats) ? d.eats.filter(function (e) {
          return e && typeof e.name === "string" && e.name;
        }) : [];
        if (!plan && !route.length && !eats.length) return;
        var li = el("li", "day");
        var dayLabel = "第 " + (Number.isInteger(d.day) ? d.day : i + 1) + " 天";
        li.appendChild(el("span", "day-label", dayLabel + "："));
        if (plan) li.appendChild(document.createTextNode(plan));

        // 推薦行程路線：地點依序排列，地點之間顯示交通方式
        if (route.length) {
          li.appendChild(el("div", "route-title", "推薦路線"));
          var steps = el("ol", "route");
          route.forEach(function (r, k) {
            var how = typeof r.transport === "string" ? r.transport : "";
            if (k > 0) {
              var move = el("li", "route-move", how ? "↓ 交通：" + how + " " : "↓ ");
              var nav = el("a", "route-nav", "Google 地圖導航");
              nav.href = directionsUrl(route[k - 1], r, g);
              nav.target = "_blank";
              nav.rel = "noopener noreferrer";
              move.appendChild(nav);
              steps.appendChild(move);
            }
            var stop = el("li", "route-stop");
            stop.appendChild(el("span", "route-num", String(k + 1)));
            stop.appendChild(el("span", "route-place", r.place + (k === 0 ? "（出發）" : "")));
            steps.appendChild(stop);
          });
          li.appendChild(steps);

          // 路線圖：有座標的地點至少 2 個才畫
          var points = [];
          route.forEach(function (r, k) {
            if (validCoord(r)) points.push({ lat: r.lat, lng: r.lng, num: k + 1, place: r.place });
          });
          if (points.length >= 2 && window.L) {
            li.appendChild(el("div", "route-title", "路線圖"));
            var box = el("div", "route-map");
            box.setAttribute("role", "region");
            li.appendChild(box);
            li.appendChild(el("p", "map-note", "地點位置由 AI 估計，可能有偏差；實際路線請點上方的「Google 地圖導航」。"));
            pendingMaps.push(function () { drawRouteMap(box, points, dayLabel); });
          }
        }
        // 推薦餐廳與小吃
        if (eats.length) li.appendChild(eatList(eats, g));
        ol.appendChild(li);
      });
      section("每日行程與推薦路線", ol);
    }

    section("交通方式", g.transport);
    section("住宿區域建議", g.lodging);
    section("推薦住宿", hotelList(Array.isArray(g.hotels) ? g.hotels : [], g));
    section("必吃美食", list(Array.isArray(g.food) ? g.food : []));
    section("必去景點", spotList(Array.isArray(g.attractions) ? g.attractions : []));
    section("必買伴手禮", souvenirList(Array.isArray(g.souvenirs) ? g.souvenirs : [], g));
    section("簽證與入境須知", g.visa);
    section("注意事項", g.notes);

    var src = el("ul", "sources");
    (Array.isArray(g.sources) ? g.sources : []).forEach(function (s) {
      // 只允許 http(s) 網址，避免 javascript: 之類的連結
      if (!s || typeof s.url !== "string" || !/^https?:\/\//i.test(s.url)) return;
      var li = el("li");
      var a = el("a", null, s.title || s.url);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      li.appendChild(a);
      src.appendChild(li);
    });
    var srcTitle = verified ? "資料來源" : "請到官方網站查證";
    if (src.childNodes.length) section(srcTitle, src);
    else section(srcTitle, "這篇攻略沒有資料來源網址，請特別小心查證。");

    updateFavBtn();
    guideCard.hidden = false;
    guideCountry = g.req_country;
    setFab(true);
    commentsCard.hidden = false;
    reportCard.hidden = false;

    // 卡片顯示後才畫地圖
    pendingMaps.forEach(function (draw) {
      try { draw(); } catch (e) { /* 地圖失敗時不影響其他內容 */ }
    });
    pendingMaps = [];
  }

  function loadComments() {
    var ul = $("comment-list");
    client
      .from("travel_comments")
      .select("id, created_at, nickname, body")
      .eq("guide_id", currentId)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(function (r) {
        ul.textContent = "";
        if (r.error) { ul.appendChild(el("li", "empty", "無法載入留言。" + describeError(r.error))); return; }
        if (!r.data.length) { ul.appendChild(el("li", "empty", "還沒有留言。")); return; }
        r.data.forEach(function (c) {
          var li = el("li");
          li.appendChild(el("p", "c-body", c.body));
          li.appendChild(el("div", "c-meta", (c.nickname || "匿名") + "・" + dateTime.format(new Date(c.created_at))));
          ul.appendChild(li);
        });
      });
  }

  function loadGuide(id) {
    currentId = id;
    guideCard.hidden = true;
    setFab(false);
    commentsCard.hidden = true;
    reportCard.hidden = true;
    hideMessage($("comment-message"));
    hideMessage($("report-message"));
    if (!client) return;
    showMessage(detailMsg, "載入中…", "info");
    client
      .from("travel_guides")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(function (r) {
        if (id !== currentId) return;
        if (r.error) { showMessage(detailMsg, "無法載入攻略。" + describeError(r.error), "err"); return; }
        if (!r.data) { showMessage(detailMsg, "找不到這篇攻略，可能已被管理員刪除。", "err"); return; }
        hideMessage(detailMsg);
        renderGuide(r.data);
        loadComments();
      })
      .catch(function (e) { showMessage(detailMsg, "無法載入攻略。" + describeError(e), "err"); });
  }

  // ---- 旅行翻譯 ----
  // 翻譯和常用句子由伺服器端函式請 Gemini 產生；常用句子存在這台裝置，離線也能看
  var trForm = $("tr-form");
  var trBtn = $("tr-btn");
  var trMsg = $("tr-message");
  var trResult = $("tr-result");
  var phBtn = $("ph-btn");
  var phMsg = $("ph-message");
  var phList = $("ph-list");
  var showCard = $("show-card");
  var trCountry = "";
  var showReturnFocus = null;
  var PHRASES_KEY = "nextstop-phrases:";
  var canSpeak = "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

  function readPhrases(country) {
    try {
      var v = JSON.parse(localStorage.getItem(PHRASES_KEY + country) || "null");
      return v && Array.isArray(v.phrases) ? v : null;
    } catch (e) { return null; }
  }

  // 切換要翻譯的國家：換國家時清掉上一個國家的譯文，改顯示該國存好的常用句子
  var TR_COUNTRY_KEY = "nextstop-tr-country";
  var trCountryInput = $("tr-country");
  function setTrCountry(country) {
    country = (country || "").trim().slice(0, 50);
    trCountryInput.value = country;
    syncTrSelect();
    if (country === trCountry) return;
    stopListening(true);
    trCountry = country;
    hideMessage(trMsg);
    hideMessage(phMsg);
    trResult.hidden = true;
    trResult.textContent = "";
    updateTrIntro();
    var saved = country ? readPhrases(country) : null;
    renderPhrases(saved);
    phBtn.hidden = !!saved;
    if (country) {
      try { localStorage.setItem(TR_COUNTRY_KEY, country); } catch (e) { /* 無法儲存時忽略 */ }
    }
    syncTrPicks();
  }
  trCountryInput.addEventListener("change", function () { setTrCountry(trCountryInput.value); });

  // 國家下拉選單：和搜尋表單用同一份清單；選「其他」時才顯示文字欄位
  var trSelect = $("tr-country-select");
  var trOther = $("tr-country-other");
  trSelect.appendChild(option("", "請選擇國家", true));
  PLACES.forEach(function (group) {
    var og = el("optgroup");
    og.label = group.region;
    group.countries.forEach(function (c) { og.appendChild(option(c.name, c.flag + " " + c.name)); });
    trSelect.appendChild(og);
  });
  trSelect.appendChild(option(OTHER, "✏️ 其他國家（自己輸入）"));
  function syncTrSelect() {
    var v = trCountryInput.value.trim();
    var known = !!findCountry(v);
    if (!v && !trOther.hidden) return; // 正在自己輸入，保持「其他」
    trSelect.value = known ? v : (v ? OTHER : "");
    if (!v) trSelect.selectedIndex = 0;
    trOther.hidden = known || !v;
  }
  trSelect.addEventListener("change", function () {
    if (trSelect.value === OTHER) {
      trOther.hidden = false;
      setTrCountry("");
      trSelect.value = OTHER;
      trCountryInput.focus();
    } else {
      trOther.hidden = true;
      setTrCountry(trSelect.value);
    }
  });

  var trPicks = $("tr-country-picks");
  POPULAR.forEach(function (p) {
    var b = el("button", null, p[0] + " " + p[1]);
    b.type = "button";
    b.setAttribute("data-country", p[1]);
    b.addEventListener("click", function () { setTrCountry(p[1]); });
    trPicks.appendChild(b);
  });
  function syncTrPicks() {
    Array.prototype.forEach.call(trPicks.children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-country") === trCountry ? "true" : "false");
    });
  }

  // ---- 翻譯面板：攻略頁右下角的浮動按鈕、首頁的「翻譯」按鈕都會打開 ----
  var trSheet = $("tr-sheet");
  var trFab = $("tr-fab");
  var guideCountry = null;
  var sheetReturnFocus = null;
  function setFab(on) {
    trFab.hidden = !on || !trSheet.hidden;
    document.body.classList.toggle("has-fab", !!on);
  }
  function openSheet(country) {
    var last = "";
    try { last = localStorage.getItem(TR_COUNTRY_KEY) || ""; } catch (e) { /* 讀不到時當作沒有 */ }
    setTrCountry(country || trCountry || last);
    sheetReturnFocus = document.activeElement;
    trSheet.hidden = false;
    trFab.hidden = true;
    document.documentElement.classList.add("sheet-open");
    $("tr-close").focus();
  }
  function closeSheet() {
    if (trSheet.hidden) return;
    stopListening(true);
    trSheet.hidden = true;
    document.documentElement.classList.remove("sheet-open");
    trFab.hidden = !document.body.classList.contains("has-fab");
    if (sheetReturnFocus && sheetReturnFocus.focus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus();
  }
  trFab.addEventListener("click", function () { openSheet(guideCountry); });
  $("tr-open-hero").addEventListener("click", function () { openSheet(null); });
  Array.prototype.forEach.call(trSheet.querySelectorAll("[data-tr-close]"), function (n) {
    n.addEventListener("click", closeSheet);
  });
  document.addEventListener("keydown", function (e) {
    // 「給對方看」開著時，Esc 只關掉大字卡片
    if (e.key === "Escape" && !e.defaultPrevented && !trSheet.hidden && showCard.hidden) closeSheet();
  });
  // 在面板上方往下滑也能關閉
  var dragY = null;
  $("tr-grip").addEventListener("touchstart", function (e) { dragY = e.touches[0].clientY; }, { passive: true });
  $("tr-grip").addEventListener("touchend", function (e) {
    if (dragY !== null && e.changedTouches[0].clientY - dragY > 70) closeSheet();
    dragY = null;
  });

  function speak(textValue, lang) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(textValue);
    if (lang) u.lang = lang;
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  function openShow(item, lang) {
    $("show-text").textContent = item.text;
    if (lang) $("show-text").setAttribute("lang", lang); else $("show-text").removeAttribute("lang");
    $("show-reading").textContent = item.reading || "";
    $("show-zh").textContent = item.zh ? "（" + item.zh + "）" : "";
    showReturnFocus = document.activeElement;
    showCard.hidden = false;
    $("show-close").focus();
  }
  function closeShow() {
    showCard.hidden = true;
    if (showReturnFocus && showReturnFocus.focus) showReturnFocus.focus();
  }
  showCard.addEventListener("click", closeShow);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !showCard.hidden) { e.preventDefault(); closeShow(); }
  });

  function actionButtons(item, lang) {
    var row = el("div", "tr-actions");
    if (canSpeak) {
      var say = el("button", "secondary", "🔊 朗讀");
      say.type = "button";
      say.addEventListener("click", function () { speak(item.text, lang); });
      row.appendChild(say);
    }
    var copy = el("button", "secondary", "📋 複製");
    copy.type = "button";
    copy.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(item.text).then(function () {
        copy.textContent = "✅ 已複製";
        setTimeout(function () { copy.textContent = "📋 複製"; }, 1500);
      }, function () { /* 無法複製時不處理 */ });
    });
    row.appendChild(copy);
    var show = el("button", null, "🪧 給對方看");
    show.type = "button";
    show.addEventListener("click", function () { openShow(item, lang); });
    row.appendChild(show);
    return row;
  }

  // ---- 翻譯方向：我說中文 → 當地語／對方說 → 中文 ----
  var trDir = "to_local";
  var dirOut = $("tr-dir-out");
  var dirIn = $("tr-dir-in");
  var langByCountry = {}; // 這次用過的當地語言代碼，給「對方說」的語音辨識用
  function updateTrIntro() {
    var c = trCountry;
    $("tr-intro").textContent = !c
      ? (trDir === "to_zh" ? "先選國家，再請對方輸入或說話，翻成中文給你看。" : "先選要去的國家，再輸入或說出想說的中文。")
      : (trDir === "to_zh"
        ? "把「" + c + "」當地人說的話翻成中文。可以把手機交給對方輸入，或按 🎤 讓對方說。"
        : "把中文翻成「" + c + "」當地的語言，可以朗讀或放大給對方看。");
  }
  function localLang() {
    var known = findCountry(trCountry);
    return langByCountry[trCountry] || (known && known.lang) || "en-US";
  }
  function setTrDir(d) {
    if (d === trDir) return;
    stopListening(true);
    trDir = d;
    dirOut.setAttribute("aria-pressed", d === "to_local" ? "true" : "false");
    dirIn.setAttribute("aria-pressed", d === "to_zh" ? "true" : "false");
    $("tr-text-label").textContent = d === "to_zh" ? "對方說的話" : "想說的話";
    trText.placeholder = d === "to_zh" ? "請對方在這裡輸入，或按 🎤 讓對方說話" : "例如：請問車站怎麼走？";
    $("tr-handoff").hidden = d !== "to_zh";
    trText.value = "";
    trResult.hidden = true;
    trResult.textContent = "";
    hideMessage(trMsg);
    updateTrIntro();
  }
  dirOut.addEventListener("click", function () { setTrDir("to_local"); });
  dirIn.addEventListener("click", function () { setTrDir("to_zh"); });

  function renderTranslation(d) {
    if (d.lang && d.direction !== "to_zh") langByCountry[trCountry] = d.lang;
    if (d.direction === "to_zh") {
      if (d.lang) langByCountry[trCountry] = d.lang;
      trResult.textContent = "";
      trResult.appendChild(el("p", "tr-lang", d.language + " → 中文"));
      var zh = el("p", "tr-text", d.text);
      zh.setAttribute("lang", "zh-TW");
      trResult.appendChild(zh);
      var src = el("p", "tr-source");
      src.appendChild(document.createTextNode("原文："));
      var orig = el("span", null, d.source);
      if (d.lang) orig.setAttribute("lang", d.lang);
      src.appendChild(orig);
      trResult.appendChild(src);
      if (d.reading) trResult.appendChild(el("p", "tr-reading", d.reading));
      var row = el("div", "tr-actions tr-actions-2");
      var copy = el("button", "secondary", "📋 複製");
      copy.type = "button";
      copy.addEventListener("click", function () {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(d.text).then(function () {
          copy.textContent = "✅ 已複製";
          setTimeout(function () { copy.textContent = "📋 複製"; }, 1500);
        }, function () { /* 無法複製時不處理 */ });
      });
      var reply = el("button", null, "↩️ 我要回覆");
      reply.type = "button";
      reply.addEventListener("click", function () { setTrDir("to_local"); trText.focus(); });
      row.appendChild(copy);
      row.appendChild(reply);
      trResult.appendChild(row);
      trResult.hidden = false;
      return;
    }
    trResult.textContent = "";
    trResult.appendChild(el("p", "tr-lang", d.language));
    var big = el("p", "tr-text", d.text);
    if (d.lang) big.setAttribute("lang", d.lang);
    trResult.appendChild(big);
    if (d.reading) trResult.appendChild(el("p", "tr-reading", d.reading));
    if (d.back) trResult.appendChild(el("p", "tr-back", "意思：" + d.back));
    trResult.appendChild(actionButtons({ text: d.text, reading: d.reading, zh: d.source }, d.lang));
    trResult.hidden = false;
  }

  function renderPhrases(data) {
    phList.textContent = "";
    if (!data) return;
    var groups = {};
    var order = [];
    data.phrases.forEach(function (p) {
      if (!groups[p.category]) { groups[p.category] = []; order.push(p.category); }
      groups[p.category].push(p);
    });
    phList.appendChild(el("p", "tr-lang", data.language));
    order.forEach(function (cat) {
      phList.appendChild(el("h4", "ph-cat", cat));
      var ul = el("ul", "ph-items");
      groups[cat].forEach(function (p) {
        var li = el("li");
        var b = el("button", "ph-item");
        b.type = "button";
        b.appendChild(el("span", "ph-zh", p.zh));
        var t = el("span", "ph-text", p.text);
        if (data.lang) t.setAttribute("lang", data.lang);
        b.appendChild(t);
        if (p.reading) b.appendChild(el("span", "ph-reading", p.reading));
        b.addEventListener("click", function () { openShow(p, data.lang); });
        li.appendChild(b);
        if (canSpeak) {
          var say = el("button", "ph-say", "🔊");
          say.type = "button";
          say.setAttribute("aria-label", "朗讀：" + p.zh);
          say.addEventListener("click", function () { speak(p.text, data.lang); });
          li.appendChild(say);
        }
        ul.appendChild(li);
      });
      phList.appendChild(ul);
    });
  }

  // ---- 語音輸入：用瀏覽器內建的語音辨識，把說的中文變成文字，說完自動翻譯 ----
  var micBtn = $("tr-mic");
  var micHint = $("tr-mic-hint");
  var trText = $("tr-text");
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognizer = null;
  var listening = false;
  var onIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var inAppBrowser = /Line\/|FBAN|FBAV|Instagram|MicroMessenger|; wv\)/i.test(navigator.userAgent);
  var MIC_BLOCKED_KEY = "nextstop-mic-blocked";

  // 瀏覽器有語音辨識、但被系統擋下時（service-not-allowed），依情況說明怎麼解決
  function micBlockedHelp() {
    if (inAppBrowser) {
      return "LINE、Facebook 等 App 裡開的網頁不能用語音輸入。請按右上角選單，選「用瀏覽器開啟」（iPhone 用 Safari、Android 用 Chrome）。現在也可以按鍵盤上的 🎤 聽寫。";
    }
    var fromHomeScreen = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
    if (onIOS && fromHomeScreen) {
      return "iPhone 從主畫面打開的 App 不能使用網頁語音輸入。請按鍵盤上的 🎤 用聽寫輸入，或改用 Safari 打開網站。";
    }
    if (onIOS) {
      return "iPhone 需要先開啟聽寫：到「設定 → 一般 → 鍵盤」打開「啟用聽寫」，再回來重新整理。現在也可以按鍵盤上的 🎤 聽寫。";
    }
    return "這個瀏覽器不允許網頁使用語音輸入。請改用鍵盤上的 🎤 語音輸入，或用 Chrome、Edge 打開網站。";
  }
  function showMicHelp(text) {
    micBtn.hidden = true;
    micHint.textContent = text;
    micHint.hidden = false;
  }

  var micBlocked = false;
  try { micBlocked = sessionStorage.getItem(MIC_BLOCKED_KEY) === "1"; } catch (e) { /* 讀不到時當作沒被擋 */ }
  if (Recognition && !micBlocked) {
    micBtn.hidden = false;
  } else if (Recognition) {
    showMicHelp(micBlockedHelp());
  } else {
    showMicHelp(onIOS
      ? "這個瀏覽器不支援語音輸入，可以按鍵盤上的 🎤 用聽寫輸入。"
      : "這個瀏覽器不支援語音輸入，請改用 Chrome、Edge 或 Safari，或用鍵盤的語音輸入。");
  }

  function setListening(on) {
    listening = on;
    micBtn.classList.toggle("listening", on);
    micBtn.setAttribute("aria-pressed", on ? "true" : "false");
    micBtn.setAttribute("aria-label", on ? "停止語音輸入" : "語音輸入");
  }

  function stopListening(cancel) {
    if (!recognizer) return;
    var r = recognizer;
    if (cancel) recognizer = null;
    try { cancel ? r.abort() : r.stop(); } catch (e) { /* 已經停止 */ }
    if (cancel) setListening(false);
  }

  var MIC_ERRORS = {
    "not-allowed": "請允許這個網站使用麥克風，才能用語音輸入。",
    "no-speech": "沒有聽到聲音，請靠近麥克風再試一次。",
    "audio-capture": "找不到麥克風，請確認裝置有麥克風。",
    "network": "語音辨識需要網路，請確認連線後再試。",
  };

  micBtn.addEventListener("click", function () {
    if (listening) { stopListening(false); return; }
    var r = new Recognition();
    var base = trText.value;
    var heard = "";
    var failed = false;
    r.lang = trDir === "to_zh" ? localLang() : "zh-TW";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = function (event) {
      if (recognizer !== r) return;
      heard = "";
      for (var i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript;
      trText.value = (base + heard).slice(0, 200);
    };
    r.onerror = function (event) {
      if (recognizer !== r || event.error === "aborted") return;
      failed = true;
      if (event.error === "service-not-allowed") {
        // 被系統擋下：這次開啟期間改成提示用鍵盤聽寫，不再顯示麥克風按鈕
        try { sessionStorage.setItem(MIC_BLOCKED_KEY, "1"); } catch (e) { /* 無法儲存時只影響這一頁 */ }
        hideMessage(trMsg);
        showMicHelp(micBlockedHelp());
        trText.focus();
        return;
      }
      showMessage(trMsg, MIC_ERRORS[event.error] || "語音輸入失敗，請再試一次或改用打字。", "err");
    };
    r.onend = function () {
      if (recognizer !== r) return;
      recognizer = null;
      setListening(false);
      if (failed) return;
      if (!heard.trim()) { showMessage(trMsg, MIC_ERRORS["no-speech"], "err"); return; }
      // 說完自動翻譯
      hideMessage(trMsg);
      if (typeof trForm.requestSubmit === "function") trForm.requestSubmit();
      else trForm.dispatchEvent(new Event("submit", { cancelable: true }));
    };
    recognizer = r;
    try {
      r.start();
    } catch (e) {
      recognizer = null;
      showMessage(trMsg, "無法開始語音輸入，請再試一次。", "err");
      return;
    }
    setListening(true);
    showMessage(trMsg, trDir === "to_zh"
      ? "正在聽對方說話…說完會自動翻成中文。再按一次麥克風可以停止。"
      : "正在聽…請說中文，說完會自動翻譯。再按一次麥克風可以停止。", "info");
  });

  trForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var source = trForm.elements.text.value.trim();
    if (!trCountry) { showMessage(trMsg, "請先選擇要去的國家。", "err"); (trOther.hidden ? trSelect : trCountryInput).focus(); return; }
    if (!source) { showMessage(trMsg, trDir === "to_zh" ? "請對方先輸入或說話。" : "請輸入想說的話。", "err"); return; }
    if (!client) return;
    var country = trCountry;
    var dir = trDir;
    trBtn.disabled = true;
    trBtn.textContent = "翻譯中…";
    showMessage(trMsg, "AI 翻譯中，大約需要 5～20 秒。", "info");
    client.functions
      .invoke(FN, { body: { translate: { country: country, text: source, direction: dir } } })
      .then(function (r) {
        if (country !== trCountry || dir !== trDir) return;
        if (r.error) {
          return readFunctionError(r.error).then(function (t) { showMessage(trMsg, "翻譯失敗。" + t, "err"); });
        }
        if (!r.data || !r.data.text) { showMessage(trMsg, "翻譯失敗：沒有收到譯文。", "err"); return; }
        hideMessage(trMsg);
        renderTranslation(r.data);
      })
      .catch(function (e) { showMessage(trMsg, "翻譯失敗。" + describeError(e), "err"); })
      .finally(function () {
        trBtn.disabled = false;
        trBtn.textContent = "翻譯";
      });
  });

  // 常用句子：AI 偶爾忙碌或回傳格式不對，失敗時自動重試一次。
  // 額度用完（429）或資料錯誤（400）重試也沒用，就不重試。
  function shouldRetryPhrases(error) {
    var status = error && error.context && error.context.status;
    return !(status === 400 || status === 429);
  }
  function loadPhrases(country, attempt) {
    client.functions
      .invoke(FN, { body: { phrases: { country: country } } })
      .then(function (r) {
        if (country !== trCountry) return;
        if (r.error) {
          if (attempt === 1 && shouldRetryPhrases(r.error)) {
            showMessage(phMsg, "AI 這次沒有回應成功，正在自動重試一次…", "info");
            setTimeout(function () { if (country === trCountry) loadPhrases(country, 2); else resetPhBtn(); }, 1500);
            return "retrying";
          }
          return readFunctionError(r.error).then(function (t) {
            showMessage(phMsg, "載入失敗" + (attempt > 1 ? "（已自動重試一次）" : "") + "：" + t.replace(/[。.]$/, "") + "。", "err");
          });
        }
        if (!r.data || !Array.isArray(r.data.phrases)) { showMessage(phMsg, "載入失敗：沒有收到句子。", "err"); return; }
        var data = { language: r.data.language, lang: r.data.lang, phrases: r.data.phrases };
        if (data.lang) langByCountry[country] = data.lang;
        try { localStorage.setItem(PHRASES_KEY + country, JSON.stringify(data)); } catch (e) { /* 無法儲存時只顯示 */ }
        hideMessage(phMsg);
        renderPhrases(data);
        phBtn.hidden = true;
      })
      .catch(function (e) {
        if (attempt === 1 && country === trCountry) {
          showMessage(phMsg, "連線不穩，正在自動重試一次…", "info");
          setTimeout(function () { if (country === trCountry) loadPhrases(country, 2); else resetPhBtn(); }, 1500);
          return "retrying";
        }
        showMessage(phMsg, "載入失敗（已自動重試一次）。" + describeError(e), "err");
      })
      .then(function (state) { if (state !== "retrying") resetPhBtn(); });
  }
  function resetPhBtn() {
    phBtn.disabled = false;
    phBtn.textContent = "載入常用句子";
  }

  phBtn.addEventListener("click", function () {
    if (!trCountry) { showMessage(phMsg, "請先選擇要去的國家。", "err"); (trOther.hidden ? trSelect : trCountryInput).focus(); return; }
    if (!client) return;
    phBtn.disabled = true;
    phBtn.textContent = "載入中…";
    showMessage(phMsg, "AI 正在整理「" + trCountry + "」的常用句子，大約需要 5～15 秒。", "info");
    loadPhrases(trCountry, 1);
  });

  favBtn.addEventListener("click", function () {
    if (!currentId) return;
    toggleFav(currentId);
    updateFavBtn();
  });

  // ---- 留言 ----
  var commentForm = $("comment-form");
  var commentBtn = $("comment-btn");
  commentForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client || !currentId) return;
    var msg = $("comment-message");
    var nickname = commentForm.elements.nickname.value.trim();
    var body = commentForm.elements.body.value.trim();
    commentForm.elements.body.setAttribute("aria-invalid", body ? "false" : "true");
    if (!body) { showMessage(msg, "請填寫留言內容。", "err"); return; }
    if (body.length > 500 || nickname.length > 20) { showMessage(msg, "暱稱最多 20 字、留言最多 500 字。", "err"); return; }

    commentBtn.disabled = true;
    client
      .from("travel_comments")
      .insert({ guide_id: currentId, nickname: nickname || null, body: body })
      .then(function (r) {
        if (r.error) { showMessage(msg, "留言失敗。" + describeError(r.error), "err"); return; }
        commentForm.reset();
        showMessage(msg, "已送出留言。", "ok");
        loadComments();
      })
      .catch(function (e) { showMessage(msg, "留言失敗。" + describeError(e), "err"); })
      .finally(function () { commentBtn.disabled = false; });
  });

  // ---- 回報 ----
  var reportForm = $("report-form");
  var reportBtn = $("report-btn");
  reportForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client || !currentId) return;
    var msg = $("report-message");
    var kind = reportForm.elements.kind.value;
    var detail = reportForm.elements.detail.value.trim();
    reportForm.elements.detail.setAttribute("aria-invalid", detail ? "false" : "true");
    if (!detail) { showMessage(msg, "請填寫說明。", "err"); return; }
    if (detail.length > 500) { showMessage(msg, "說明最多 500 字。", "err"); return; }

    reportBtn.disabled = true;
    client
      .from("travel_reports")
      .insert({ guide_id: currentId, kind: kind, detail: detail })
      .then(function (r) {
        if (r.error) { showMessage(msg, "回報失敗。" + describeError(r.error), "err"); return; }
        reportForm.reset();
        showMessage(msg, "已收到回報，謝謝！管理員會再確認。", "ok");
      })
      .catch(function (e) { showMessage(msg, "回報失敗。" + describeError(e), "err"); })
      .finally(function () { reportBtn.disabled = false; });
  });

  // =====================================================================
  // 頁面切換：#/ 是首頁，#/guide/<id> 是攻略內容
  // =====================================================================
  // =====================================================================
  // 首頁背景：美景照片輪播
  // =====================================================================
  var slides = Array.prototype.slice.call(document.querySelectorAll(".hero-slides .slide"));
  var dotsBox = $("hero-dots");
  var creditEl = $("hero-credit");
  var slideIndex = 0;
  var slideTimer = null;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showSlide(i) {
    if (!slides.length) return;
    slideIndex = (i + slides.length) % slides.length;
    slides.forEach(function (s, k) { s.classList.toggle("active", k === slideIndex); });
    Array.prototype.forEach.call(dotsBox.children, function (d, k) {
      d.setAttribute("aria-current", k === slideIndex ? "true" : "false");
    });
    // 照片地點與出處（授權要求標示作者與授權）
    var s = slides[slideIndex].dataset;
    creditEl.textContent = "";
    creditEl.appendChild(document.createTextNode("📍 " + s.place + "　"));
    var a = el("a", null, "照片：" + s.artist + "／" + s.license);
    a.href = s.source;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    creditEl.appendChild(a);
  }

  function startSlides() {
    stopSlides();
    if (reduceMotion || slides.length < 2) return; // 使用者設定減少動態時不自動輪播
    slideTimer = setInterval(function () { showSlide(slideIndex + 1); }, 6000);
  }
  function stopSlides() {
    if (slideTimer) clearInterval(slideTimer);
    slideTimer = null;
  }

  slides.forEach(function (s, k) {
    var dot = el("button", "hero-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", "第 " + (k + 1) + " 張：" + s.dataset.place);
    dot.addEventListener("click", function () { showSlide(k); startSlides(); });
    dotsBox.appendChild(dot);
  });
  showSlide(0);
  // 頁面在背景時暫停，省電
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopSlides(); else if (document.body.classList.contains("is-home")) startSlides();
  });

  function route() {
    var m = /^#\/guide\/([^/]+)$/.exec(location.hash);
    var imp = /^#\/import\/([0-9A-Fa-f,-]+)$/.exec(location.hash);
    var detail = !!m;
    // 首頁顯示大張輪播；攻略頁縮小頁首並停止輪播
    document.body.classList.toggle("is-home", !detail);
    if (detail) stopSlides(); else startSlides();
    $("view-list").hidden = detail;
    closeSheet();
    if (!detail) { guideCountry = null; setFab(false); }
    $("view-detail").hidden = !detail;
    window.scrollTo(0, 0);
    if (detail) {
      var id = decodeURIComponent(m[1]);
      if (!/^[0-9a-f-]{36}$/i.test(id)) { showMessage(detailMsg, "攻略網址不正確。", "err"); return; }
      loadGuide(id);
    } else {
      loadList();
    }
    if (imp) showImport(imp[1]);
    else if (!detail) importBox.hidden = true;
  }

  window.addEventListener("hashchange", route);
  route();

  // =====================================================================
  // PWA：離線提示、安裝到主畫面、Service Worker
  // =====================================================================
  var offlineMsg = $("offline-message");
  function updateOnline() { offlineMsg.hidden = navigator.onLine; }
  window.addEventListener("online", function () { updateOnline(); route(); });
  window.addEventListener("offline", updateOnline);
  updateOnline();

  var INSTALL_DISMISS_KEY = "travel-guide-install-dismissed";
  var installBar = $("install-bar");
  var installBtn = $("install-btn");
  var deferredPrompt = null;

  function installDismissed() {
    try { return localStorage.getItem(INSTALL_DISMISS_KEY) === "1"; } catch (e) { return false; }
  }
  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Android／電腦版 Chrome、Edge：瀏覽器提供安裝視窗
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    if (!installDismissed()) {
      installBtn.hidden = false;
      installBar.hidden = false;
    }
  });
  installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () {
      deferredPrompt = null;
      installBar.hidden = true;
    });
  });
  window.addEventListener("appinstalled", function () {
    installBar.hidden = true;
    setGetAppVisible(false);
  });

  // ---- 「下載 App」按鈕：有安裝視窗就直接跳出，沒有就顯示操作說明 ----
  var getAppBtns = [$("get-app-hero"), $("get-app-foot")];
  var appDialog = $("app-dialog");
  var lastFocus = null;
  function setGetAppVisible(on) {
    getAppBtns.forEach(function (b) { b.hidden = !on; });
  }
  function openAppDialog() {
    var isAndroid = /android/i.test(navigator.userAgent);
    $("app-steps-ios").hidden = !isIOS;
    $("app-steps-android").hidden = !isAndroid;
    $("app-steps-desktop").hidden = isIOS || isAndroid;
    lastFocus = document.activeElement;
    appDialog.hidden = false;
    $("app-dialog-close").focus();
  }
  function closeAppDialog() {
    appDialog.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  getAppBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
      } else {
        openAppDialog();
      }
    });
  });
  Array.prototype.forEach.call(appDialog.querySelectorAll("[data-close]"), function (el) {
    el.addEventListener("click", closeAppDialog);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !appDialog.hidden) closeAppDialog();
  });

  // 已經用 App 開啟時，不顯示「下載 App」
  setGetAppVisible(!standalone);

  // iPhone／iPad 的 Safari 沒有安裝視窗，只能顯示操作說明
  if (isIOS && !standalone && !installDismissed()) {
    $("install-text").textContent = "安裝到主畫面：點 Safari 下方的「分享」按鈕，再選「加入主畫面」。";
    installBtn.hidden = true;
    installBar.hidden = false;
  }

  $("install-close").addEventListener("click", function () {
    installBar.hidden = true;
    try { localStorage.setItem(INSTALL_DISMISS_KEY, "1"); } catch (e) { /* 無法儲存時忽略 */ }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* 註冊失敗時網頁照常使用 */ });
    });
  }
})();
