/* ============================================================
   CAFE FO+REST — 連線設定
   ------------------------------------------------------------
   這是整套系統你唯一需要親手填的檔案，只有兩個值。
   兩個值都在 Supabase 後台的 Project Settings → API Keys 裡。

   ⚠️ 提醒：下面的 PUBLISHABLE_KEY 是「可以公開」的金鑰，
   放進 GitHub 公開儲存庫沒有問題，資料安全是靠 schema.sql
   裡的權限規則（RLS）在保護。

   ❌ 但是 Secret key（sb_secret_... 開頭的那一支）
   絕對不能貼在這裡，那支是後台管理用的萬能鑰匙。
   ============================================================ */

const SUPABASE_URL = '請貼上你的 Project URL';
// 長得像：https://abcdefghijklmn.supabase.co

const SUPABASE_PUBLISHABLE_KEY = '請貼上你的 Publishable key';
// 長得像：sb_publishable_xxxxxxxxxxxxxxxxxxxx


/* ------------------------------------------------------------
   以下不用改動
   ------------------------------------------------------------ */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function isConfigured() {
  return !SUPABASE_URL.startsWith('請貼上') && !SUPABASE_PUBLISHABLE_KEY.startsWith('請貼上');
}

function configWarning() {
  return '尚未完成連線設定：請打開 supabase-config.js，填入你的 Project URL 與 Publishable key。';
}
