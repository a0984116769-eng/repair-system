-- =====================================================================
-- 報修登記系統：資料表與存取規則
-- 依據：報修需求筆記.txt
-- 示範規則：任何人（anon）可以新增、可以讀取清單，但不能修改或刪除。
-- 新增時「處理狀態」一律是「待處理」，不能由送出表單的人決定。
--
-- 這份檔案只描述設計，請在 Supabase 的 SQL Editor 確認內容後再執行。
-- 可以重複執行：資料表已存在時不會重建，存取規則會先刪除再重建。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 建立資料表，並用 CHECK 限制欄位值與文字長度（第三層：CHECK）
-- ---------------------------------------------------------------------
-- 文字欄位先去掉前後空白再算長度，避免只填空白字元就通過。
-- 長度上限是示範用的假設值，筆記沒有寫明，正式使用前需確認。
create table if not exists public.repair_requests (
  -- 編號：系統自動產生的 uuid
  id            uuid        primary key default gen_random_uuid(),

  -- 登記時間：送出時由資料庫自動產生
  created_at    timestamptz not null default now(),

  -- 報修人姓名：必填，1～50 字
  reporter_name text        not null
    constraint repair_requests_reporter_name_length
      check (char_length(btrim(reporter_name)) between 1 and 50),

  -- 地點或部門：必填，1～100 字
  location      text        not null
    constraint repair_requests_location_length
      check (char_length(btrim(location)) between 1 and 100),

  -- 類別：只能是 設備／網路／環境／其他
  category      text        not null
    constraint repair_requests_category_values
      check (category in ('設備', '網路', '環境', '其他')),

  -- 問題說明：必填，1～1000 字
  description   text        not null
    constraint repair_requests_description_length
      check (char_length(btrim(description)) between 1 and 1000),

  -- 緊急程度：只能是 低／中／高，預設「中」
  urgency       text        not null default '中'
    constraint repair_requests_urgency_values
      check (urgency in ('低', '中', '高')),

  -- 處理狀態：只能是 待處理／處理中／已完成，預設「待處理」
  status        text        not null default '待處理'
    constraint repair_requests_status_values
      check (status in ('待處理', '處理中', '已完成'))
);

comment on table  public.repair_requests               is '報修登記';
comment on column public.repair_requests.id            is '編號';
comment on column public.repair_requests.created_at    is '登記時間（系統自動產生）';
comment on column public.repair_requests.reporter_name is '報修人姓名';
comment on column public.repair_requests.location      is '地點或部門';
comment on column public.repair_requests.category      is '類別：設備、網路、環境、其他';
comment on column public.repair_requests.description   is '問題說明';
comment on column public.repair_requests.urgency       is '緊急程度：低、中、高';
comment on column public.repair_requests.status        is '處理狀態：待處理、處理中、已完成';

-- 清單依登記時間由新到舊顯示，建立索引加快排序。
create index if not exists repair_requests_created_at_idx
  on public.repair_requests (created_at desc);


-- ---------------------------------------------------------------------
-- 資料表權限（第一層：GRANT）
-- ---------------------------------------------------------------------
-- 先收回所有權限，確保 anon 和 authenticated 沒有任何預先給的權限，
-- 再只開放需要的部分。本次示範不做登入，所以 authenticated 不給任何權限。
revoke all on table public.repair_requests from public, anon, authenticated;

-- anon 需要使用 public schema 才能存取裡面的資料表。
grant usage on schema public to anon;

-- anon 可以讀取清單（所有欄位）。
grant select on table public.repair_requests to anon;

-- anon 只能新增「表單要填的欄位」。
-- 不開放 id、created_at、status：這三個欄位一律使用資料庫的預設值，
-- 送出時如果帶了這些欄位，資料庫會直接拒絕。
grant insert (reporter_name, location, category, description, urgency)
  on table public.repair_requests to anon;

-- 不給 update、delete、truncate：anon 無法修改或刪除任何資料。


-- ---------------------------------------------------------------------
-- 資料列安全（第二層：RLS）
-- ---------------------------------------------------------------------
-- 啟用 RLS 之後，沒有符合任何規則的操作一律被拒絕。
alter table public.repair_requests enable row level security;

-- 任何人都可以讀取清單。
drop policy if exists "任何人可以讀取報修清單" on public.repair_requests;
create policy "任何人可以讀取報修清單"
  on public.repair_requests
  for select
  to anon
  using (true);

-- 任何人都可以新增報修，但處理狀態只能是「待處理」。
-- GRANT 已經不讓 anon 指定 status，這條規則是第二道防線：
-- 即使以後有人誤把 status 的新增權限開放出去，也無法新增其他狀態。
drop policy if exists "任何人可以新增報修（狀態限待處理）" on public.repair_requests;
create policy "任何人可以新增報修（狀態限待處理）"
  on public.repair_requests
  for insert
  to anon
  with check (status = '待處理');

-- 沒有 update、delete 的規則：即使權限被誤開，RLS 仍會拒絕修改和刪除。
