# How this app is built

This is a Plexo app: React 19 + TypeScript + Vite + Tailwind CSS v4 + React Router, with a
real backend (Postgres database, sign-in, server functions, file storage) built in. Plexo
installs, builds and hosts it — there's nothing to configure.

## Layout

| Path | What goes there |
| --- | --- |
| `src/pages/` | One component per page. Register each in `src/App.tsx` above the `*` route. |
| `src/plexo-canvas/` | Pages designed visually in the editor's Design tab: `<name>.canvas.json` is the design, `<Name>Page.tsx` the code Plexo generates from it, `routes.tsx` their addresses (rendered in `src/App.tsx`). Saving a design regenerates its page — change designed pages in the Design tab, or edit the `.tsx` (the Design tab then asks before replacing your edits). Don't edit `routes.tsx` or `design-system.json` by hand. |
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
- Add npm packages by adding them to `package.json` `dependencies`. Keep them small: big
  server SDKs (`stripe`, `aws-sdk`, `firebase-admin`, `googleapis`…) make the build run out of
  time and are refused — call those services' HTTP APIs with `fetch` from a server function.
- Make every page responsive (it should look right on a phone) and give every async view
  a loading state and an empty state.

## Design

This app should look like a premium product a real company would ship — never a template.

- **Its own identity.** Pick a palette that fits the business and set it in `src/index.css`
  (`--primary`, `--accent`, `--background`…). Pair a characterful heading font with a clean
  body font from Google Fonts: add the `<link>` to `index.html`, then set them in
  `src/index.css` (`--font-heading`, `--font-sans` in `@theme`).
- **Its own icon.** Replace `public/favicon.svg` with a simple, bold mark that fits the
  business, in the app's colours and legible at 16px; set `<title>` and the meta description
  in `index.html`.
- **Full pages.** A striking hero — bold headline, a specific benefit-led subheading, a clear
  main action and a strong visual — then the sections a real page of this kind has
  (benefits, how it works, social proof, pricing, FAQ, closing call to action, footer).
- **Real photos.** Use `app_find_photos` (Unsplash, Pexels, Pixabay) with a specific, visual
  search; credit the photographer in a small caption or the footer. Or compose a product mock
  from the UI components. Never a broken or random placeholder image.
- **Depth and motion.** Soft gradients or mesh backgrounds, layered low-opacity shadows, cards
  with real hierarchy; `motion` for gentle entrance and hover effects
  (`import { motion } from "motion/react"`); `lucide-react` icons.
- **Real words.** Specific copy for this business — no lorem ipsum or "Company Name".
- **Every state designed.** Empty states get an icon, a friendly line and an action; loading
  states get skeletons. Everything looks right at phone width.

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

## Payments

Take payments with Stripe Checkout from a server function — `fetch`, no Stripe package. The
owner adds their key in Plexo → your app → Secret keys as `STRIPE_SECRET_KEY`.

```ts
// functions/create-checkout.ts
import type { PlexoFunction } from "./types";

const handler: PlexoFunction = async (req, { user, env }) => {
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { origin } = new URL(req.url);
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": "Premium access",
    "line_items[0][price_data][unit_amount]": "4900", // cents
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    success_url: `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const session = await res.json();
  if (!res.ok) return Response.json({ error: session.error?.message ?? "Payment couldn't start" }, { status: 400 });
  return Response.json({ url: session.url });
};
export default handler;
```

In the app: `const { data } = await plexo.functions.invoke("create-checkout"); location.assign(data.url);`

To confirm a payment, have another server function fetch
`https://api.stripe.com/v1/checkout/sessions/<session_id>` (same `Authorization` header) on the
thanks page and record it when `payment_status` is `"paid"` — never trust the browser alone.
