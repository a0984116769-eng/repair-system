-- =====================================================================
-- 國外旅遊攻略：資料表與存取規則
-- 依據：國外旅遊攻略/需求筆記.txt
--
-- 規則摘要：
-- - 不需要登入，網頁一律用 anon（publishable key）連線。
-- - 任何人都可以讀攻略和留言。
-- - 攻略只能由伺服器端函式（generate-guide，使用 service_role）新增，網頁不能直接新增。
-- - 任何人都可以新增留言和「資訊過時／錯誤」回報。
-- - 網頁上沒有人能修改或刪除任何資料；管理員在 Supabase 後台處理。
-- - 收藏只存在瀏覽器裡，不需要資料表。
--
-- 請在 Supabase 的 SQL Editor 確認內容後執行。可以重複執行。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 攻略
-- ---------------------------------------------------------------------
create table if not exists public.travel_guides (
  -- 編號與建立時間：自動產生
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),

  -- 旅遊者請 AI 產生時輸入的條件
  req_country      text        not null check (char_length(btrim(req_country)) between 1 and 50),
  req_city         text                 check (req_city is null or char_length(req_city) <= 50),
  req_days         integer     not null check (req_days between 1 and 14),
  req_budget_twd   integer     not null check (req_budget_twd between 0 and 1000000),

  -- 攻略內容（AI 整理）
  country          text        not null check (char_length(btrim(country)) between 1 and 50),
  city             text        not null check (char_length(city) <= 100),
  days             integer     not null check (days between 1 and 14),        -- 建議天數
  season           text        not null check (char_length(season) <= 500),   -- 適合季節
  budget           text        not null check (char_length(budget) <= 1000),  -- 預算範圍
  itinerary        jsonb       not null default '[]'::jsonb                   -- 每日行程：[{ "day": 1, "plan": "…" }]
                                check (jsonb_typeof(itinerary) = 'array'),
  transport        text        not null check (char_length(transport) <= 3000),   -- 交通方式
  lodging          text        not null check (char_length(lodging) <= 2000),     -- 住宿區域建議
  food             jsonb       not null default '[]'::jsonb                       -- 必吃美食：["…"]
                                check (jsonb_typeof(food) = 'array'),
  attractions      jsonb       not null default '[]'::jsonb                       -- 必去景點：["…"]
                                check (jsonb_typeof(attractions) = 'array'),
  visa             text        not null check (char_length(visa) <= 3000),        -- 簽證與入境須知
  notes            text        not null check (char_length(notes) <= 3000),       -- 注意事項
  sources          jsonb       not null default '[]'::jsonb                       -- 資料來源：[{ "title": "…", "url": "https://…" }]
                                check (jsonb_typeof(sources) = 'array'),
  compiled_on      date        not null default current_date,                     -- AI 整理的日期
  model            text        not null check (char_length(model) <= 100)         -- 使用的 AI 模型
);

create index if not exists travel_guides_created_at_idx
  on public.travel_guides (created_at desc);


-- ---------------------------------------------------------------------
-- 留言
-- ---------------------------------------------------------------------
create table if not exists public.travel_comments (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  -- 攻略被刪除時，留言一起刪除
  guide_id    uuid        not null references public.travel_guides (id) on delete cascade,
  -- 暱稱可不填，最多 20 字；不要填真實姓名
  nickname    text        check (nickname is null or char_length(btrim(nickname)) between 1 and 20),
  body        text        not null check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists travel_comments_guide_idx
  on public.travel_comments (guide_id, created_at);


-- ---------------------------------------------------------------------
-- 「資訊過時／錯誤」回報
-- ---------------------------------------------------------------------
create table if not exists public.travel_reports (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  guide_id    uuid        not null references public.travel_guides (id) on delete cascade,
  kind        text        not null check (kind in ('資訊過時', '資訊錯誤')),
  detail      text        not null check (char_length(btrim(detail)) between 1 and 500)
);

create index if not exists travel_reports_guide_idx
  on public.travel_reports (guide_id);


-- ---------------------------------------------------------------------
-- 資料表權限（GRANT）
-- 這個專案不會自動開放新資料表，所以要明確給權限。
-- ---------------------------------------------------------------------
revoke all on table public.travel_guides, public.travel_comments, public.travel_reports
  from public, anon, authenticated;

grant usage on schema public to anon, service_role;

-- 攻略：anon 只能讀
grant select on table public.travel_guides to anon;

-- 留言：anon 可以讀，以及新增表單上的欄位（不能指定 id、created_at）
grant select on table public.travel_comments to anon;
grant insert (guide_id, nickname, body) on table public.travel_comments to anon;

-- 回報：anon 只能新增，不能讀（回報內容給管理員在後台看）
grant insert (guide_id, kind, detail) on table public.travel_reports to anon;

-- 伺服器端函式用 service_role 寫入攻略；管理員也可能透過它管理資料
grant select, insert, update, delete
  on table public.travel_guides, public.travel_comments, public.travel_reports
  to service_role;

-- 不給 anon 任何 update、delete：網頁上沒有人能修改或刪除資料。


-- ---------------------------------------------------------------------
-- 資料列安全（RLS）
-- service_role 不受 RLS 限制，所以下面只需要寫 anon 的規則。
-- ---------------------------------------------------------------------
alter table public.travel_guides   enable row level security;
alter table public.travel_comments enable row level security;
alter table public.travel_reports  enable row level security;

drop policy if exists "任何人可以讀攻略" on public.travel_guides;
create policy "任何人可以讀攻略"
  on public.travel_guides for select to anon
  using (true);

drop policy if exists "任何人可以讀留言" on public.travel_comments;
create policy "任何人可以讀留言"
  on public.travel_comments for select to anon
  using (true);

drop policy if exists "任何人可以新增留言" on public.travel_comments;
create policy "任何人可以新增留言"
  on public.travel_comments for insert to anon
  with check (true);

drop policy if exists "任何人可以新增回報" on public.travel_reports;
create policy "任何人可以新增回報"
  on public.travel_reports for insert to anon
  with check (true);

-- 攻略沒有 anon 的新增規則：網頁不能直接新增攻略。
-- 三張表都沒有 update、delete 規則：網頁上不能修改或刪除。
