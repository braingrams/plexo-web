# How this app is built

This is a Plexo app: React 19 + TypeScript + Vite + Tailwind CSS v4 + React Router, with a
real backend (Postgres database, sign-in, server functions, file storage) built in. Plexo
installs, builds and hosts it — there's nothing to configure.

## Layout

| Path | What goes there |
| --- | --- |
| `src/pages/` | One component per page. Register each in `src/App.tsx` above the `*` route. |
| `src/components/` | Your components. `src/components/ui/` holds the UI kit (shadcn/ui style). |
| `src/lib/plexo.ts` | The backend client — `plexo.from()`, `plexo.auth`, `plexo.functions`, `plexo.storage`. Don't edit. |
| `src/lib/plexo-react.tsx` | `useAuth()` and `<RequireAuth>`. |
| `src/index.css` | Design tokens (colors, radius). Restyle the app here. |
| `db/migrations/` | SQL that creates and changes tables. See its README. |
| `functions/` | Server code: `functions/<name>.ts`, called with `plexo.functions.invoke("<name>")`. See `functions/types.ts`. |
| `public/` | Static files served as-is (`/favicon.svg`). |
| `PLEXO.md` | This file — add notes about your app's own conventions at the bottom. |

## Rules that keep the app working

- Import with the `@/` alias: `import { Button } from "@/components/ui/button"`.
- Use the design tokens (`bg-primary`, `text-muted-foreground`, `border`, `bg-card`) instead
  of hard-coded colors, so the whole app restyles from `src/index.css`.
- Data comes from the database through `plexo` — never hard-code data that should persist.
- Every table needs row-level-security policies before the app can reach it (it's on by
  default and denies everything until a policy allows it).
- Secrets (API keys) never go in `src/` — everything in `src/` is shipped to browsers. Use a
  server function and read the key from `env`.
- Add npm packages by adding them to `package.json` `dependencies`.
- Make every page responsive (it should look right on a phone) and give every async view
  a loading state and an empty state.

## Data

```ts
import { plexo } from "@/lib/plexo";

const { data: todos, error } = await plexo.from("todos").select("*").order("created_at", { ascending: false });
await plexo.from("todos").insert({ title });
await plexo.from("todos").update({ done: true }).eq("id", id);
await plexo.from("todos").delete().eq("id", id);
const { data: post } = await plexo.from("posts").select("*, author:profiles(name, avatar_url)").eq("slug", slug).single();
```

With React Query (already set up):

```ts
const { data, isLoading } = useQuery({ queryKey: ["todos"], queryFn: async () => {
  const { data, error } = await plexo.from("todos").select("*");
  if (error) throw new Error(error.message);
  return data;
}});
```

## Sign-in

```ts
const { user, loading } = useAuth();
await plexo.auth.signUp({ email, password, data: { name } });
await plexo.auth.signInWithPassword({ email, password });
await plexo.auth.signInWithOtp({ email });           // emailed sign-in link
plexo.auth.signInWithOAuth({ provider: "google" });   // when Google sign-in is enabled
await plexo.auth.resetPasswordForEmail(email);         // link goes to /reset-password?token=…
await plexo.auth.signOut();
```

Wrap private pages: `<Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />`.
A `/login` page is expected when using `RequireAuth` (it sends visitors to `/login?next=…`).

## Files

```ts
const { data, error } = await plexo.storage.from("avatars").upload(`${user.id}/photo.png`, file, { upsert: true });
// data.publicUrl — save it on a row (public buckets only)
const { data: link } = await plexo.storage.from("documents").createSignedUrl(`${user.id}/contract.pdf`);
```

- Buckets are created on first upload — nothing to set up.
- **Signed-in visitors upload into their own folder**: the path must start with their user id
  (`${user.id}/…`). They can list and remove only their own files.
- Buckets named `avatars`, `images`, `media`, `public` or `public-…` are **public** (anyone can
  view a file by its URL). Every other bucket is **private**: only the person who uploaded a
  file can open it, through `createSignedUrl`.
- Files a server function writes (`ctx.db` has full access) can go anywhere.
