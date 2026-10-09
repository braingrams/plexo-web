# Database migrations

Each `.sql` file here changes your app's database. Plexo applies new files in name order
(`0001_…`, `0002_…`): to your **preview** database when you build, and to your **live**
database when you publish — so a change is always tried on preview first. A file that's been
applied is never re-run; to change something, add a new migration instead of editing an old one.

## Security is on by default

Every table you create in `public` automatically has row-level security switched on, which
means **nobody can read or write it from the app until you add a policy** saying who can:

```sql
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default plexo.uid() references plexo.users(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create policy "Owners read their todos"   on public.todos for select to plexo_authenticated using (user_id = plexo.uid());
create policy "Owners add todos"          on public.todos for insert to plexo_authenticated with check (user_id = plexo.uid());
create policy "Owners update their todos" on public.todos for update to plexo_authenticated using (user_id = plexo.uid());
create policy "Owners delete their todos" on public.todos for delete to plexo_authenticated using (user_id = plexo.uid());

-- Anyone, signed in or not, can read published posts:
-- create policy "Public posts" on public.posts for select to plexo_anon, plexo_authenticated using (published);
```

- `plexo.uid()` — the signed-in visitor's id (null when signed out).
- `plexo.role()` — their role (`plexo.users.role`, "user" unless you change it).
- `plexo_anon` — signed-out visitors. `plexo_authenticated` — signed-in visitors.
- `plexo.users` — your app's accounts (id, email, role, metadata, created_at). Reference it
  from your own tables; keep extra profile fields in your own `public.profiles` table.
