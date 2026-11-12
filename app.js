(function () {
  "use strict";

  var TABLE = "repair_requests";
  var LIST_LIMIT = 20;

  var form = document.getElementById("repair-form");
  var submitBtn = document.getElementById("submit-btn");
  var formMsg = document.getElementById("form-message");
  var listMsg = document.getElementById("list-message");
  var list = document.getElementById("request-list");
  var refreshBtn = document.getElementById("refresh-btn");
  var desc = document.getElementById("description");
  var descCount = document.getElementById("desc-count");

  function showMessage(el, text, kind) {
    el.textContent = text;
    el.className = "message " + kind;
    el.hidden = false;
  }

  function hideMessage(el) {
    el.hidden = true;
    el.textContent = "";
  }

  // ---- 檢查設定 ----
  var cfg = window.REPAIR_CONFIG || {};
  var configured =
    typeof cfg.supabaseUrl === "string" && /^https:\/\//.test(cfg.supabaseUrl) &&
    typeof cfg.supabaseKey === "string" && cfg.supabaseKey.length > 0 &&
    cfg.supabaseKey.indexOf("【") === -1;

  var client = null;
  if (!configured) {
    var setupText = "尚未設定 Supabase：請在 config.js 填入專案網址與 publishable key。";
    showMessage(formMsg, setupText, "err");
    showMessage(listMsg, setupText, "err");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
  } else if (!window.supabase || typeof window.supabase.createClient !== "function") {
    var loadText = "無法載入 Supabase 程式庫，請檢查網路連線後重新整理頁面。";
    showMessage(formMsg, loadText, "err");
    showMessage(listMsg, loadText, "err");
    submitBtn.disabled = true;
    refreshBtn.disabled = true;
  } else {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // ---- 問題說明字數 ----
  function updateCount() {
    descCount.textContent = String(desc.value.length);
  }
  desc.addEventListener("input", updateCount);

  // ---- 表單驗證 ----
  var LIMITS = { reporter_name: 50, location: 100, description: 1000 };
  var LABELS = { reporter_name: "報修人", location: "地點或部門", category: "類別", description: "問題說明" };
  var CATEGORIES = ["設備", "網路", "環境", "其他"];
  var URGENCIES = ["低", "中", "高"];

  function readForm() {
    var data = new FormData(form);
    return {
      reporter_name: String(data.get("reporter_name") || "").trim(),
      location: String(data.get("location") || "").trim(),
      category: String(data.get("category") || ""),
      description: String(data.get("description") || "").trim(),
      urgency: String(data.get("urgency") || "中"),
    };
  }

  function validate(values) {
    var firstBad = null;
    var problems = [];
    ["reporter_name", "location", "category", "description"].forEach(function (key) {
      var el = form.elements[key];
      var bad = false;
      if (!values[key]) {
        problems.push("請填寫「" + LABELS[key] + "」");
        bad = true;
      } else if (LIMITS[key] && values[key].length > LIMITS[key]) {
        problems.push("「" + LABELS[key] + "」最多 " + LIMITS[key] + " 字");
        bad = true;
      }
      el.setAttribute("aria-invalid", bad ? "true" : "false");
      if (bad && !firstBad) firstBad = el;
    });
    if (values.category && CATEGORIES.indexOf(values.category) === -1) problems.push("類別不正確");
    if (URGENCIES.indexOf(values.urgency) === -1) problems.push("緊急程度不正確");
    if (firstBad) firstBad.focus();
    return problems;
  }

  function describeError(error) {
    var msg = (error && error.message) || "";
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "連線失敗，請檢查網路後再試一次。";
    if (error && error.code === "42501") return "沒有權限執行這個動作，請聯絡管理員確認資料表權限。";
    if (error && error.code === "23514") return "資料格式不符合規定，請檢查各欄位內容。";
    return "發生錯誤：" + (msg || "未知錯誤") + (error && error.code ? "（代碼 " + error.code + "）" : "");
  }

  // ---- 送出 ----
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client) return;
    hideMessage(formMsg);

    var values = readForm();
    var problems = validate(values);
    if (problems.length) {
      showMessage(formMsg, problems.join("；") + "。", "err");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";

    // 只送表單欄位；不送 status、id、created_at，由資料庫自動產生。
    client
      .from(TABLE)
      .insert({
        reporter_name: values.reporter_name,
        location: values.location,
        category: values.category,
        description: values.description,
        urgency: values.urgency,
      })
      .then(function (result) {
        if (result.error) {
          showMessage(formMsg, "送出失敗。" + describeError(result.error), "err");
          return;
        }
        form.reset();
        updateCount();
        showMessage(formMsg, "已送出報修，謝謝！", "ok");
        loadList();
      })
      .catch(function (err) {
        showMessage(formMsg, "送出失敗。" + describeError(err), "err");
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "送出報修";
      });
  });

  // ---- 清單 ----
  var timeFormat = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // 一律用 textContent，避免使用者輸入被當成 HTML
    return node;
  }

  function renderList(rows) {
    list.textContent = "";
    if (!rows.length) {
      list.appendChild(el("li", "empty", "目前還沒有報修資料。"));
      return;
    }
    rows.forEach(function (row) {
      var li = el("li");
      var top = el("div", "item-top");
      top.appendChild(el("span", "tag", row.category));
      top.appendChild(el("span", "tag urgency-" + row.urgency, "緊急程度：" + row.urgency));
      top.appendChild(el("span", "tag", row.status));
      li.appendChild(top);
      li.appendChild(el("p", "item-desc", row.description));
      var when = row.created_at ? timeFormat.format(new Date(row.created_at)) : "";
      li.appendChild(el("div", "item-meta", row.reporter_name + "・" + row.location + "・" + when));
      list.appendChild(li);
    });
  }

  function loadList() {
    if (!client) return;
    refreshBtn.disabled = true;
    client
      .from(TABLE)
      .select("id, created_at, reporter_name, location, category, description, urgency, status")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT)
      .then(function (result) {
        if (result.error) {
          showMessage(listMsg, "無法載入清單。" + describeError(result.error), "err");
          return;
        }
        hideMessage(listMsg);
        renderList(result.data || []);
      })
      .catch(function (err) {
        showMessage(listMsg, "無法載入清單。" + describeError(err), "err");
      })
      .finally(function () {
        refreshBtn.disabled = false;
      });
  }

  refreshBtn.addEventListener("click", loadList);
  loadList();
})();
