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
      var text = q ? "找不到符合的收藏攻略。" : "還沒有收藏的攻略。在上方產生攻略後，按「☆ 收藏」就會保留在這裡。";
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
    if (problems.length) {
      showMessage(genMsg, problems.join("；") + "。", "err");
      return;
    }

    genBtn.disabled = true;
    genBtn.textContent = "AI 搜尋整理中，請稍候…";
    showMessage(genMsg, "AI 正在整理攻略，大約需要 10～30 秒，請不要關閉頁面。", "info");

    client.functions
      .invoke(FN, { body: { country: country, city: city, days: days, budget: budget } })
      .then(function (r) {
        if (r.error) {
          return readFunctionError(r.error).then(function (text) {
            showMessage(genMsg, "產生失敗。" + text, "err");
          });
        }
        var id = r.data && r.data.id;
        if (!id) { showMessage(genMsg, "產生失敗：伺服器沒有回傳攻略編號。", "err"); return; }
        genForm.reset();
        hideMessage(genMsg);
        location.hash = "#/guide/" + encodeURIComponent(id);
      })
      .catch(function (e) { showMessage(genMsg, "產生失敗。" + describeError(e), "err"); })
      .finally(function () {
        genBtn.disabled = false;
        genBtn.textContent = "產生攻略";
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
    "住宿區域建議": "🏨", "必吃美食": "🍜", "必去景點": "📍", "簽證與入境須知": "🛂",
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
        if (!plan && !route.length) return;
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
        ol.appendChild(li);
      });
      section("每日行程與推薦路線", ol);
    }

    section("交通方式", g.transport);
    section("住宿區域建議", g.lodging);
    section("必吃美食", list(Array.isArray(g.food) ? g.food : []));
    section("必去景點", spotList(Array.isArray(g.attractions) ? g.attractions : []));
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
  function route() {
    var m = /^#\/guide\/([^/]+)$/.exec(location.hash);
    var detail = !!m;
    $("view-list").hidden = detail;
    $("view-detail").hidden = !detail;
    window.scrollTo(0, 0);
    if (detail) {
      var id = decodeURIComponent(m[1]);
      if (!/^[0-9a-f-]{36}$/i.test(id)) { showMessage(detailMsg, "攻略網址不正確。", "err"); return; }
      loadGuide(id);
    } else {
      loadList();
    }
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
  window.addEventListener("appinstalled", function () { installBar.hidden = true; });

  // iPhone／iPad 的 Safari 沒有安裝視窗，只能顯示操作說明
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
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
