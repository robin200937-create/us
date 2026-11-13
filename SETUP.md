# Us: setup

There are three parts. Part 1 gets it online, part 2 links your two phones, and part 3 installs it.

---

## 1. Put it on GitHub Pages (free)

1. On github.com, create a new **public** repository, e.g. `us`.
   (GitHub Pages is free for public repos. Your data is still private: see "Privacy" below.)
2. Upload everything inside this folder: drag the files into the repo page, then **Commit**.
3. In the repo, go to **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
4. After about a minute you get a link like `https://YOURNAME.github.io/us/`.

To change something later (dates, notes, new legs), edit `config.js` on GitHub and commit. Both phones pick up the change the next time the app opens.

(Vercel and Netlify also work. Use "Import from GitHub" and leave the default settings.)

---

## 2. Link your two phones (Supabase, free, about 10 min)

This is what makes both screens the same: hearts, moods, postcards, "I've landed", check-ins and live location all show up on the other phone straight away.

1. Create a free project at https://supabase.com.
2. Go to **SQL Editor → New query**, paste everything below and click **Run**:

```sql
-- Tables. Nobody can read them directly; only through the functions below,
-- and only with the pairing code (which the app hashes on the phone).
create table if not exists pings (
  id bigserial primary key,
  room text not null, sender text not null, kind text not null, text text default '',
  created_at timestamptz default now()
);
create table if not exists postcards (
  id bigserial primary key,
  room text not null, sender text not null, caption text default '', path text not null,
  created_at timestamptz default now()
);
create index if not exists pings_room_idx on pings (room, created_at desc);
create index if not exists postcards_room_idx on postcards (room, created_at desc);
alter table pings enable row level security;
alter table postcards enable row level security;
revoke all on pings, postcards from anon, authenticated;

create or replace function add_ping(p_room text, p_sender text, p_kind text, p_text text)
returns void language sql security definer set search_path = public as $$
  insert into pings (room, sender, kind, text) values (p_room, p_sender, p_kind, coalesce(p_text, ''));
$$;

create or replace function get_pings(p_room text)
returns setof pings language sql security definer set search_path = public as $$
  (select * from pings where room = p_room and kind <> 'loc' order by created_at desc limit 300)
  union all
  (select distinct on (sender) * from pings where room = p_room and kind = 'loc' order by sender, created_at desc);
$$;

create or replace function add_postcard(p_room text, p_sender text, p_caption text, p_path text)
returns void language sql security definer set search_path = public as $$
  insert into postcards (room, sender, caption, path) values (p_room, p_sender, coalesce(p_caption, ''), p_path);
$$;

create or replace function get_postcards(p_room text)
returns setof postcards language sql security definer set search_path = public as $$
  select * from postcards where room = p_room order by created_at desc limit 100;
$$;

grant execute on function add_ping, get_pings, add_postcard, get_postcards to anon;

-- Photo storage: uploads allowed, listing not allowed.
insert into storage.buckets (id, name, public) values ('postcards', 'postcards', true)
  on conflict (id) do nothing;
create policy "postcard upload" on storage.objects for insert to anon
  with check (bucket_id = 'postcards');
```

3. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `config.js` (`supabaseUrl`, `supabaseAnonKey`), then commit.
4. Open the app on each phone. It asks two things:
   - **Who's using this phone?** MJ or Kanesh.
   - **Pairing code.** Type the **same** phrase on both phones (8+ characters, something only you two know). Don't put it in GitHub.

The footer will then say **"synced"**.

---

## 3. Install on both iPhones

Open the link in **Safari**, then tap **Share → Add to Home Screen**.
Open the app from its home-screen icon and turn on **Share my location** if you want to. iPhone will ask permission the first time.

---

## How updates reach each other
- **While the app is open:** the other person's actions show up within a second or two, with a small pop-up at the bottom.
- **When the app is closed:** everything is waiting in "Between us" the next time it opens.
- **Lock-screen notifications:** these aren't set up. iPhone supports them for installed web apps, but they need a small server. That can be added later if you want it.

## Live location
- This is off by default. Each person turns it on for their own side.
- It's rounded to about 1 km. That's enough for the town name and the weather, not a street address.
- It only updates while the app is open. iPhone doesn't let web apps track location in the background.
- If it's more than 6 hours old, her side goes back to the planned itinerary. During a flight or train, the journey takes over.

## Privacy
- `config.js` is public on GitHub, but the Supabase key can't read anything on its own. Every read goes through the functions above and needs the hashed pairing code.
- Photos are stored under a random-looking folder name and can't be listed. Anyone with an exact photo link could still open it, so don't upload anything you'd hate to leak.
- After the trip you can delete everything in Supabase: **Table editor → pings / postcards → delete rows**, and empty the `postcards` storage bucket.

## Things still to fill in (`config.js`)
- **Second Airbnb:** right now it guesses Rovaniemi for 15–19 Nov and the Tromsø villa for 20–24 Nov.
- **The train:** it guesses the 19:29 Santa Claus Express. There's also one at 23:13.
- **Rovaniemi → Tromsø, and the flights home:** add these to `legs` (there's an example in the file).
