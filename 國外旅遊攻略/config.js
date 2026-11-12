// Supabase 連線設定
// 這裡只能放「publishable key」（公開金鑰），它本來就會出現在網頁上。
// 絕對不要放 secret key、service_role key 或 Gemini 的 API 金鑰。
window.TRAVEL_CONFIG = {
  supabaseUrl: "https://ltmuuxslnawhwzguosyi.supabase.co",
  supabaseKey: "sb_publishable_Fe1LosrmJmkJSieOKVwHwA_DBRUkPX6",
  // 產生攻略的伺服器端函式名稱（supabase/functions/generate-guide）
  generateFunction: "generate-guide",
};
