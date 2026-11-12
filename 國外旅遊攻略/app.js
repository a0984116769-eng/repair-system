(function () {
  "use strict";

  var LIST_LIMIT = 50;
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
  var filterFav = $("filter-fav");
  var refreshBtn = $("refresh-btn");
  var allGuides = [];

  function renderList() {
    listEl.textContent = "";
    var q = filterText.value.trim().toLowerCase();
    var rows = allGuides.filter(function (g) {
      if (filterFav.checked && !isFav(g.id)) return false;
      if (!q) return true;
      return (g.country + " " + (g.city || "")).toLowerCase().indexOf(q) !== -1;
    });
    if (!rows.length) {
      var text = filterFav.checked ? "還沒有收藏的攻略。" : q ? "找不到符合的攻略。" : "目前還沒有攻略，試著產生第一篇吧。";
      listEl.appendChild(el("li", "empty", text));
      return;
    }
    rows.forEach(function (g) {
      var li = el("li");
      var a = el("a");
      a.href = "#/guide/" + encodeURIComponent(g.id);
      var name = el("div", "g-name", (isFav(g.id) ? "★ " : "") + guideName(g));
      var sub = el("div", "g-sub", g.days + " 天・AI 整理於 " + g.compiled_on);
      a.appendChild(name);
      a.appendChild(sub);
      li.appendChild(a);
      listEl.appendChild(li);
    });
  }

  function loadList() {
    if (!client) return;
    refreshBtn.disabled = true;
    var query = client
      .from("travel_guides")
      .select("id, created_at, country, city, days, compiled_on")
      .order("created_at", { ascending: false });
    // 只看收藏時，直接查收藏的攻略，不受最新 50 篇的限制
    query = filterFav.checked && favs.length ? query.in("id", favs.slice(0, 200)) : query.limit(LIST_LIMIT);
    query
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
  filterFav.addEventListener("change", loadList);
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
    showMessage(genMsg, "AI 正在上網搜尋並整理攻略，大約需要 10～60 秒，請不要關閉頁面。", "info");

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

  function section(title, content) {
    if (content == null || content === "" || (Array.isArray(content) && !content.length)) return;
    guideBody.appendChild(el("h3", null, title));
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
  }

  function renderGuide(g) {
    $("guide-title").textContent = guideName(g);
    var asked = g.req_country + (g.req_city ? "・" + g.req_city : "") + "，" + g.req_days + " 天，每人每天約 NT$" +
      Number(g.req_budget_twd).toLocaleString("zh-TW");
    $("guide-meta").textContent =
      "建議 " + g.days + " 天・AI 整理日期 " + g.compiled_on + "・模型 " + g.model + "\n查詢條件：" + asked;
    $("guide-meta").style.whiteSpace = "pre-wrap";
    guideBody.textContent = "";

    section("適合季節", g.season);
    section("預算範圍", g.budget);

    var days = Array.isArray(g.itinerary) ? g.itinerary : [];
    if (days.length) {
      var ol = el("ul", "plain-list");
      days.forEach(function (d, i) {
        if (!d || typeof d.plan !== "string") return;
        var li = el("li");
        li.appendChild(el("span", "day-label", "第 " + (Number.isInteger(d.day) ? d.day : i + 1) + " 天："));
        li.appendChild(document.createTextNode(d.plan));
        ol.appendChild(li);
      });
      section("每日行程", ol);
    }

    section("交通方式", g.transport);
    section("住宿區域建議", g.lodging);
    section("必吃美食", list(Array.isArray(g.food) ? g.food : []));
    section("必去景點", list(Array.isArray(g.attractions) ? g.attractions : []));
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
    if (src.childNodes.length) section("資料來源", src);
    else section("資料來源", "這篇攻略沒有取得資料來源網址，請特別小心查證。");

    updateFavBtn();
    guideCard.hidden = false;
    commentsCard.hidden = false;
    reportCard.hidden = false;
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
})();
