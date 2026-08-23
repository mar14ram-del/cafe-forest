/* ============================================================
   CAFE FO+REST — 連線設定
   ------------------------------------------------------------
   ✅ 已設定完成，不需要再修改任何內容。

   之後如果要換金鑰或搬到別的 Supabase 專案，
   就只改下面那兩行的引號內容。

   ------------------------------------------------------------
   ⚠️ 金鑰安全提醒
   下面的 PUBLISHABLE_KEY 是「可以公開」的金鑰，放進 GitHub
   公開儲存庫沒有問題。資料安全是靠 schema.sql 裡的權限規則
   （RLS）在保護，不是靠把金鑰藏起來。

   ❌ Secret key（sb_secret_... 開頭那一支）絕對不能貼在這裡，
      也絕對不能上傳到 GitHub。那支是萬能鑰匙，一旦外流，
      客戶資料與薪資資料都會被拿走。
   ============================================================ */


const SUPABASE_URL = 'https://znvvfatfhetblhntnxgg.supabase.co';

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oqmp3haibMfJxU3fmRqCMQ_bkA310Jv';


/* ------------------------------------------------------------
   以下不用改動
   ------------------------------------------------------------ */

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/** 檢查設定是否填妥，並擋掉常見的貼錯狀況 */
function isConfigured() {
  return configProblem() === null;
}

/** 回傳設定的問題描述；沒問題則回傳 null */
function configProblem() {
  const url = String(SUPABASE_URL || '');
  const key = String(SUPABASE_PUBLISHABLE_KEY || '');

  if (key.startsWith('sb_secret_')) {
    return '你貼的是 Secret key（萬能鑰匙），不能放在網站裡。' +
           '請立刻回 Supabase 撤銷這支金鑰，改用 Publishable key。';
  }
  if (url.startsWith('sb_publishable_') || url.startsWith('sb_secret_')) {
    return 'SUPABASE_URL 這行貼成金鑰了。這行要放的是網址，' +
           '長得像 https://abcdefghijklmn.supabase.co';
  }
  if (url.includes('在這裡貼上') || !url.startsWith('https://')) {
    return '尚未填入 Project URL。請打開 supabase-config.js，' +
           '把第一行換成你的網址（https://你的專案代號.supabase.co）。';
  }
  if (!url.includes('.supabase.co')) {
    return 'Project URL 格式看起來不對，正確的長得像 https://abcdefghijklmn.supabase.co';
  }
  if (!key.startsWith('sb_publishable_')) {
    return 'Publishable key 格式看起來不對，正確的以 sb_publishable_ 開頭。';
  }
  return null;
}

function configWarning() {
  return configProblem() || '';
}
