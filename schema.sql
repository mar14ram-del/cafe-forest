-- ============================================================
--  CAFE FO+REST — Supabase 資料庫建置腳本
--  使用方式：整份複製，貼進 Supabase 後台的 SQL Editor，按 Run。
--  可重複執行（會先清掉舊的再重建）。
-- ============================================================


-- ============================================================
--  0. 清除舊版本（第一次執行時這段不會做任何事）
-- ============================================================
drop function if exists public.place_order(text,text,text,text,text,text,text,jsonb);
drop function if exists public.check_coupon(text);
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.product_materials cascade;
drop table if exists public.coupons cascade;
drop table if exists public.products cascade;
drop table if exists public.materials cascade;
drop table if exists public.employees cascade;
drop table if exists public.expenses cascade;
drop table if exists public.payment_methods cascade;
drop sequence if exists public.order_seq;


-- ============================================================
--  1. 資料表
-- ============================================================

-- 咖啡豆（含產地資訊，地球上的標記就是讀這裡）
create table public.products (
  id             text primary key,
  name           text not null,
  meta           text default '',          -- 烘焙度 · 風味
  description    text default '',
  price          numeric not null default 0,
  image_url      text default '',
  active         boolean not null default true,
  sort_order     int default 0,
  origin_country text default '',
  origin_lat     numeric,
  origin_lon     numeric,
  origin_blurb   text default '',
  created_at     timestamptz default now()
);

-- 物料（生豆、包材、贈品）
create table public.materials (
  id           text primary key,
  name         text not null,
  category     text default '生豆',
  unit         text default 'g',
  stock        numeric not null default 0,
  safety_stock numeric not null default 0,
  created_at   timestamptz default now()
);

-- 用料表 BOM：一包豆子要耗掉哪些物料、各多少
create table public.product_materials (
  product_id   text references public.products(id) on delete cascade,
  material_id  text references public.materials(id) on delete cascade,
  qty_per_unit numeric not null default 0,
  primary key (product_id, material_id)
);

-- 付款方式（後台可自訂內容與 QR Code 圖片）
create table public.payment_methods (
  id          text primary key,
  name        text not null,
  type        text not null default 'transfer',  -- transfer / qrcode / cash
  enabled     boolean not null default true,
  bank        text default '',
  branch      text default '',
  account     text default '',
  holder      text default '',
  note        text default '',
  qr_image_url text default '',
  qr_caption  text default '',
  sort_order  int default 0
);

-- 優惠券 / 兌換券
create table public.coupons (
  id            bigserial primary key,
  code          text unique not null,
  customer_name text default '',
  phone         text default '',
  kind          text not null default 'discount',   -- discount / exchange
  discount_type text default 'percent',             -- percent(打折) / fixed(折抵金額)
  discount_value numeric default 0,
  exchange_item text default '',
  expiry        date,
  status        text not null default '未使用',      -- 未使用 / 已使用
  used_order_id text,
  created_at    timestamptz default now()
);

-- 訂單
create sequence public.order_seq start 1;

create table public.orders (
  id             text primary key,
  created_at     timestamptz default now(),
  customer_name  text not null,
  phone          text not null,
  delivery       text not null default 'pickup',    -- pickup / delivery
  address        text default '',
  note           text default '',
  payment_method text default '',
  payment_name   text default '',
  payment_status text default '待付款',
  subtotal       numeric not null default 0,
  discount       numeric not null default 0,
  total          numeric not null default 0,
  coupon_code    text,
  coupon_note    text default '',
  status         text not null default '待處理'      -- 待處理 / 已出貨 / 已完成
);

create table public.order_items (
  id           bigserial primary key,
  order_id     text references public.orders(id) on delete cascade,
  product_id   text,
  product_name text,
  unit_price   numeric not null default 0,
  qty          int not null default 1
);

-- 員工薪資
create table public.employees (
  id        bigserial primary key,
  name      text not null,
  role      text default '',
  pay_type  text default 'monthly',   -- monthly / hourly
  base      numeric default 0,
  hours     numeric default 0,
  bonus     numeric default 0
);

-- 支出
create table public.expenses (
  id        bigserial primary key,
  name      text not null,
  category  text default '其他',
  spent_on  date default current_date,
  amount    numeric default 0
);


-- ============================================================
--  2. 伺服器端函式
--     這兩個函式跑在資料庫裡，客人的瀏覽器改不了。
--     金額、庫存、券的核銷都在這裡算完才寫進資料庫。
-- ============================================================

-- 驗券：只回傳「這張券能不能用、折多少」，不會讓外人撈到整張券的清單
create or replace function public.check_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c public.coupons%rowtype;
begin
  select * into c from public.coupons
   where upper(code) = upper(trim(p_code));

  if not found then
    return jsonb_build_object('ok', false, 'reason', '查無此代碼');
  end if;
  if c.status = '已使用' then
    return jsonb_build_object('ok', false, 'reason', '這張券已經使用過了');
  end if;
  if c.expiry is not null and c.expiry < current_date then
    return jsonb_build_object('ok', false, 'reason', '這張券已經過期了');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', c.code,
    'kind', c.kind,
    'discount_type', c.discount_type,
    'discount_value', c.discount_value,
    'exchange_item', c.exchange_item
  );
end;
$$;


-- 下單：算金額、驗券、扣庫存、寫訂單，全部在伺服器端一次完成
create or replace function public.place_order(
  p_customer_name text,
  p_phone         text,
  p_delivery      text,
  p_address       text,
  p_note          text,
  p_payment       text,
  p_coupon_code   text,
  p_items         jsonb          -- [{"product_id":"GB-ETH","qty":2}, ...]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id   text;
  v_item       jsonb;
  v_product    public.products%rowtype;
  v_qty        int;
  v_subtotal   numeric := 0;
  v_discount   numeric := 0;
  v_total      numeric := 0;
  v_coupon     public.coupons%rowtype;
  v_coupon_note text := '';
  v_pay        public.payment_methods%rowtype;
  v_bom        record;
begin
  -- 基本檢查
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_phone),'') = '' then
    return jsonb_build_object('ok', false, 'reason', '請填寫姓名與電話');
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'reason', '請至少選擇一款咖啡豆');
  end if;
  if p_delivery = 'delivery' and coalesce(trim(p_address),'') = '' then
    return jsonb_build_object('ok', false, 'reason', '宅配需要填寫地址');
  end if;

  -- 產生訂單編號
  v_order_id := 'FR-' || to_char(now() at time zone 'Asia/Taipei', 'YYMMDD')
                || '-' || lpad(nextval('public.order_seq')::text, 3, '0');

  -- 先建立訂單主檔
  select * into v_pay from public.payment_methods where id = p_payment and enabled;

  insert into public.orders (id, customer_name, phone, delivery, address, note,
                             payment_method, payment_name, payment_status)
  values (v_order_id, trim(p_customer_name), trim(p_phone), p_delivery,
          coalesce(p_address,''), coalesce(p_note,''),
          coalesce(v_pay.id,''), coalesce(v_pay.name,''),
          case when v_pay.type = 'cash' then '到店付款' else '待付款' end);

  -- 逐項處理：價格一律以資料庫為準，不採用瀏覽器送來的金額
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product from public.products
     where id = (v_item->>'product_id') and active;

    if not found then
      raise exception '找不到商品或該商品已下架：%', (v_item->>'product_id');
    end if;

    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));
    v_subtotal := v_subtotal + v_product.price * v_qty;

    insert into public.order_items (order_id, product_id, product_name, unit_price, qty)
    values (v_order_id, v_product.id, v_product.name, v_product.price, v_qty);

    -- 依用料表扣掉對應物料
    for v_bom in
      select material_id, qty_per_unit from public.product_materials
       where product_id = v_product.id
    loop
      update public.materials
         set stock = stock - (v_bom.qty_per_unit * v_qty)
       where id = v_bom.material_id;
    end loop;
  end loop;

  -- 處理優惠券
  if coalesce(trim(p_coupon_code),'') <> '' then
    select * into v_coupon from public.coupons
     where upper(code) = upper(trim(p_coupon_code))
       and status = '未使用'
       and (expiry is null or expiry >= current_date)
     for update;

    if found then
      if v_coupon.kind = 'discount' then
        if v_coupon.discount_type = 'percent' then
          v_discount := round(v_subtotal * (1 - v_coupon.discount_value / 10.0));
        else
          v_discount := v_coupon.discount_value;
        end if;
        v_discount := least(v_subtotal, greatest(0, v_discount));
        v_coupon_note := v_coupon.code || '（' ||
          case when v_coupon.discount_type = 'percent'
               then v_coupon.discount_value || ' 折'
               else '折抵 NT$' || v_coupon.discount_value end || '）';
      else
        v_coupon_note := v_coupon.code || '（兌換：' || v_coupon.exchange_item || '）';
      end if;

      update public.coupons
         set status = '已使用', used_order_id = v_order_id
       where id = v_coupon.id;
    else
      v_coupon_note := '';
    end if;
  end if;

  v_total := v_subtotal - v_discount;

  update public.orders
     set subtotal = v_subtotal,
         discount = v_discount,
         total = v_total,
         coupon_code = nullif(trim(p_coupon_code), ''),
         coupon_note = v_coupon_note
   where id = v_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total,
    'coupon_note', v_coupon_note
  );
end;
$$;


-- ============================================================
--  3. 權限規則（RLS）★★★ 這一段是整套系統的保全 ★★★
--
--  網站原始碼是公開的，任何人都能看到 admin.html 長什麼樣子。
--  真正擋住外人的不是「不知道網址」，是下面這些規則。
--
--  規則的意思是：
--    · 沒登入的訪客（anon）：只能看到上架的商品與啟用的付款方式
--    · 沒登入的訪客：完全讀不到訂單、客戶、券、物料、薪資、支出
--    · 已登入的管理者（authenticated）：全部可讀可寫
--    · 訪客要下單，只能透過上面那兩個函式，不能直接寫資料表
-- ============================================================

alter table public.products          enable row level security;
alter table public.materials         enable row level security;
alter table public.product_materials enable row level security;
alter table public.payment_methods   enable row level security;
alter table public.coupons           enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.employees         enable row level security;
alter table public.expenses          enable row level security;

-- 訪客可以看的：上架商品、啟用中的付款方式
create policy "訪客可看上架商品" on public.products
  for select to anon using (active = true);

create policy "訪客可看啟用的付款方式" on public.payment_methods
  for select to anon using (enabled = true);

-- 管理者（登入後）對所有資料表有完整權限
create policy "管理者可管理商品"    on public.products          for all to authenticated using (true) with check (true);
create policy "管理者可管理物料"    on public.materials         for all to authenticated using (true) with check (true);
create policy "管理者可管理用料表"  on public.product_materials for all to authenticated using (true) with check (true);
create policy "管理者可管理付款方式" on public.payment_methods  for all to authenticated using (true) with check (true);
create policy "管理者可管理券"      on public.coupons           for all to authenticated using (true) with check (true);
create policy "管理者可管理訂單"    on public.orders            for all to authenticated using (true) with check (true);
create policy "管理者可管理訂單品項" on public.order_items      for all to authenticated using (true) with check (true);
create policy "管理者可管理員工"    on public.employees         for all to authenticated using (true) with check (true);
create policy "管理者可管理支出"    on public.expenses          for all to authenticated using (true) with check (true);

-- 注意：orders / coupons / materials / employees / expenses
-- 完全沒有給 anon 的政策，代表未登入者一列都讀不到。這是刻意的。


-- ============================================================
--  4. 明確授權（GRANT）
--
--  2026 年 5 月後新建的 Supabase 專案，資料表預設不對外開放，
--  一定要寫下面這幾行，網站才讀得到資料。
-- ============================================================

grant usage on schema public to anon, authenticated;

-- 訪客：只給「讀商品、讀付款方式」，其他什麼都不給
grant select on public.products        to anon;
grant select on public.payment_methods to anon;

-- 訪客：只能執行這兩個函式來下單與驗券
grant execute on function public.check_coupon(text) to anon, authenticated;
grant execute on function public.place_order(text,text,text,text,text,text,text,jsonb) to anon, authenticated;

-- 管理者：全部資料表可讀寫
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;


-- ============================================================
--  5. 範例資料（之後在後台可以直接改掉或刪掉）
-- ============================================================

insert into public.materials (id, name, category, unit, stock, safety_stock) values
  ('RAW-ETH', '生豆 · 衣索比亞 耶加雪菲', '生豆', 'g', 18000, 5000),
  ('RAW-PAN', '生豆 · 巴拿馬 藝伎瑰夏',   '生豆', 'g',  4200, 3000),
  ('RAW-COL', '生豆 · 哥倫比亞 薇拉',     '生豆', 'g', 15000, 5000),
  ('RAW-GTM', '生豆 · 瓜地馬拉 安提瓜',   '生豆', 'g', 12000, 5000),
  ('RAW-TWN', '生豆 · 台灣 阿里山',       '生豆', 'g',  6000, 2000),
  ('PK-BAG',  '半磅單向排氣袋',           '包材', '個',  640,  200),
  ('PK-VAL',  '單向排氣閥',               '包材', '個',  700,  200),
  ('PK-LBL',  '品牌標籤貼紙',             '包材', '個', 1500,  400),
  ('PK-BOX',  '宅配紙箱',                 '包材', '個',  180,   50);

insert into public.products
  (id, name, meta, description, price, sort_order, origin_country, origin_lat, origin_lon, origin_blurb) values
  ('GB-ETH', '衣索比亞 耶加雪菲', '淺焙 · 花香/柑橘', '明亮酸質，茉莉花香伴隨佛手柑尾韻。', 420, 1,
   '衣索比亞', 6.2, 38.2, '咖啡的發源地，高海拔水洗處理，帶明亮的茉莉花香與佛手柑尾韻。'),
  ('GB-PAN', '巴拿馬 藝伎瑰夏', '淺中焙 · 茉莉/蜜桃', '產區限量，花香調性突出，尾韻帶蜜桃甜感。', 780, 2,
   '巴拿馬', 8.8, -82.4, '翡翠莊園帶起的品種傳奇，花香與蜜桃甜感突出，是拍賣會常勝軍。'),
  ('GB-COL', '哥倫比亞 薇拉', '中焙 · 焦糖/核桃', '均衡厚實，適合日常手沖與美式。', 380, 3,
   '哥倫比亞', 2.5, -76.3, '安地斯山脈孕育的經典產區，甜感與酸質均衡，是日常配方豆的常見基底。'),
  ('GB-GTM', '瓜地馬拉 安提瓜', '中深焙 · 巧克力/香料', '厚實醇厚，帶淡淡煙燻與辛香尾韻。', 400, 4,
   '瓜地馬拉', 14.6, -90.7, '火山土壤與日夜溫差造就厚實酒體，帶淡淡煙燻與辛香尾韻。'),
  ('GB-TWN', '台灣 阿里山', '淺中焙 · 蜜香/烏龍', '在地小農直送，帶有淡淡蜜香與茶感。', 520, 5,
   '台灣', 23.5, 120.8, '高山雲霧環境帶來蜜香與淡淡茶感，是店內少數的在地產區。');

-- 用料表：一包熟豆 227g，生豆放 250g（烘焙失重約 15%）
insert into public.product_materials (product_id, material_id, qty_per_unit) values
  ('GB-ETH','RAW-ETH',250), ('GB-ETH','PK-BAG',1), ('GB-ETH','PK-VAL',1), ('GB-ETH','PK-LBL',1),
  ('GB-PAN','RAW-PAN',250), ('GB-PAN','PK-BAG',1), ('GB-PAN','PK-VAL',1), ('GB-PAN','PK-LBL',1),
  ('GB-COL','RAW-COL',250), ('GB-COL','PK-BAG',1), ('GB-COL','PK-VAL',1), ('GB-COL','PK-LBL',1),
  ('GB-GTM','RAW-GTM',250), ('GB-GTM','PK-BAG',1), ('GB-GTM','PK-VAL',1), ('GB-GTM','PK-LBL',1),
  ('GB-TWN','RAW-TWN',250), ('GB-TWN','PK-BAG',1), ('GB-TWN','PK-VAL',1), ('GB-TWN','PK-LBL',1);

insert into public.payment_methods (id, name, type, sort_order, bank, branch, account, holder, note, qr_caption) values
  ('transfer', '銀行轉帳／ATM 匯款', 'transfer', 1,
   '國泰世華銀行（013）', '中壢分行', '123-456-789012', '森林咖啡有限公司',
   '轉帳後請保留帳號末五碼，我們會在一個工作天內核對並安排出貨。', '掃描此 QR Code 可帶入本店帳號'),
  ('linepay', 'LINE Pay', 'qrcode', 2, '', '', '', '',
   '請用 LINE 掃描下方 QR Code 完成付款，付款後截圖傳到本店 LINE 官方帳號。', 'LINE Pay 收款碼'),
  ('cash', '門市取貨付現', 'cash', 3, '', '', '', '',
   '取貨時以現金或行動支付結帳，不需事先付款。', '');

insert into public.employees (name, role, pay_type, base, hours, bonus) values
  ('林小築', '店長',   'monthly', 38000, 0, 2000),
  ('陳建豪', '烘豆師', 'monthly', 34000, 0, 0),
  ('黃詩涵', '工讀生', 'hourly',    190, 80, 0);


-- ============================================================
--  完成。接著請回到「安裝教學」的第三步。
-- ============================================================
