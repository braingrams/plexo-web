/**
 * Builds the Echoes of Experience by Tolu site on the admin@serenitypashomecare.com account — UNPUBLISHED: it never
 * attaches a domain or subdomain and never calls publish. Safe to re-run: it finds what it made before (by name / slug /
 * title) and updates it, so nothing is duplicated.
 *
 *   # 1) prepare the images (see prepare-images.py), then a read-only dry run:
 *   AWS_PROFILE=plexo PLEXO_CORE_TABLE=plexo-core … ASSET_OUT=<assets>/out npx tsx scripts/echoes-of-experience/build.ts
 *   # 2) write:
 *   … npx tsx scripts/echoes-of-experience/build.ts --apply
 *
 * Needs the AWS profile for the target environment and the seven PLEXO_*_TABLE names, set explicitly (lib/db/client.ts
 * refuses to guess). Writes touch ONLY the owner's organisation. Plan limits are respected, never changed: when the plan
 * allows one page only, Home carries the contact form and the other pages are skipped (and reported).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { User, Member, UploadedImage } from "../../lib/db/coreEntities";
import { Template, BlogSite, BlogAuthor, BlogPost } from "../../lib/db/contentEntities";
import { CustomContentEntry, type CustomContentField } from "../../lib/db/customContentEntities";
import { effectivePlan } from "../../lib/plan/entitlement";
import { getTierFeatures } from "../../lib/subscription";
import { uploadObject } from "../../lib/storage";
import { compileTemplate } from "../../lib/compileTemplate";
import { compileTemplateWithSiteLayout } from "../../lib/siteLayoutCore";
import { createV2Page, PageToolError } from "../../lib/mcp/v2Pages";
import { parseV2Design, type V2Design } from "../../lib/v2/design";
import { validateEntryData } from "../../lib/customContent/fields";
import { ensureContentPreset, type ContentPresetId } from "../../lib/customContent/presets";
import { createBlogPost, updateBlogPost } from "../../lib/blog/savePostCore";
import { assertPublishedBlogPostQuota } from "../../lib/blog/publishQuota";
import { convertWordPressHtmlToTiptapJson } from "../../lib/blogImport/htmlToTiptap";
import { hasBlogMarker } from "../../lib/pub/blogLayoutRender";
import type { resolveUser } from "../../lib/auth/resolveUser";

import { setContentMode, setMultiPage, type PageSpec, type SiteImages } from "./design";
import { BLOG_POSTS, SAMPLE_EVENTS, SAMPLE_STORIES, SAMPLE_VIDEOS, SITE_NAME, blogLayouts, designFor, sitePages } from "./site";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

const OWNER_EMAIL = "admin@serenitypashomecare.com";
const apply = process.argv.includes("--apply");
const assets = process.env.ASSET_OUT;
if (!assets) throw new Error("Set ASSET_OUT to the folder prepare-images.py wrote (…/assets/out).");

const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.USER_CONTENT_BUCKET_NAME || (process.env.PLEXO_CORE_TABLE === "plexo-core" ? "plexo-user-content" : "");
if (!BUCKET) throw new Error("Set USER_CONTENT_BUCKET_NAME for the target environment.");
process.env.USER_CONTENT_BUCKET_NAME = BUCKET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

const log = (...a: unknown[]) => console.log(...a);
const step = (t: string) => log(`\n— ${t}`);

/** Same answer the SDK this repo is built with gives the editor and the server: does it know the Content list block? */
function sdkHasContentBlock(): boolean {
  const probe = {
    format: "plexo-v2@1",
    pages: [{ id: "p", name: "p", slug: "p", rootNode: { id: "root", type: "page", name: "p", styles: {}, children: [{ id: "c", type: "contentList", name: "c", props: { contentType: "videos" }, styles: {} }] } }],
  };
  return parseV2Design(probe).ok;
}

async function main() {
  log(apply ? "APPLYING — writing to the owner's organisation" : "DRY RUN — nothing is written (pass --apply to write)");
  log("tables:", process.env.PLEXO_CORE_TABLE, process.env.PLEXO_CONTENT_TABLE, "| bucket:", BUCKET);

  // ---- who
  step("Owner");
  const { data: users } = await User.query.byEmail({ email: OWNER_EMAIL }).go();
  if (users.length !== 1) throw new Error(`Expected exactly one account for ${OWNER_EMAIL}, found ${users.length}.`);
  const user = users[0];
  const organizationId = `personal-${user.id}`;
  const { data: member } = await Member.get({ organizationId, userId: user.id }).go();
  if (!member) throw new Error(`${OWNER_EMAIL} isn't a member of ${organizationId}.`);
  const plan = effectivePlan(user);
  const features = getTierFeatures(plan);
  const resolved = {
    userId: user.id,
    organizationId,
    role: null,
    subscriptionPlan: plan,
    customDomainLimit: user.customDomainLimit ?? null,
    manageLandingPagePublishing: true,
  } as unknown as ResolvedUser;
  log(`account ${user.id} · workspace ${organizationId} · plan ${plan} · sites allowed ${features.maxLandingPages} · multi-page sites ${features.multiPageSitesEnabled ? "yes" : "NO (Ultra)"}`);

  const contentBlock = sdkHasContentBlock();
  const multiPage = features.multiPageSitesEnabled;
  setMultiPage(multiPage);
  setContentMode(contentBlock ? "block" : "static");
  log(`editor SDK ${contentBlock ? "has" : "does NOT have"} the Content list block → ${contentBlock ? "video/story/event lists use it" : "Home's latest-video row is plain elements; Stories/Videos/Happenings pages are skipped"}`);

  // ---- images
  step("Images");
  const files: Record<string, { file: string; type: string }> = {
    logo: { file: "logo.png", type: "image/png" },
    hero: { file: "hero-bg.jpg", type: "image/jpeg" },
    heroMobile: { file: "hero-mobile.jpg", type: "image/jpeg" },
    cta: { file: "cta-bg.jpg", type: "image/jpeg" },
    leaf: { file: "footer-leaf.png", type: "image/png" },
    videoThumb: { file: "video-thumb.jpg", type: "image/jpeg" },
    favicon: { file: "favicon.png", type: "image/png" },
    og: { file: "og.jpg", type: "image/jpeg" },
    scriptFont: { file: "OoohBaby.woff2", type: "font/woff2" },
    blog1: { file: "blog-1.jpg", type: "image/jpeg" },
    blog2: { file: "blog-2.jpg", type: "image/jpeg" },
    blog3: { file: "blog-3.jpg", type: "image/jpeg" },
  };
  const urls: Record<string, string> = {};
  for (const [key, f] of Object.entries(files)) {
    const rel = `media/${user.id}/echoes-of-experience/${f.file}`;
    urls[key] = `https://${BUCKET}.s3.${REGION}.amazonaws.com/public/${rel}`;
    if (!apply) continue;
    const { url } = await uploadObject(rel, readFileSync(path.join(assets!, f.file)), { access: "public", contentType: f.type });
    urls[key] = url;
    if (f.type.startsWith("image/")) await UploadedImage.put({ id: `echoes-${key}`, userId: user.id, organizationId, name: `Echoes of Experience — ${f.file}`, url }).go();
  }
  log(apply ? `uploaded ${Object.keys(urls).length} images` : `would upload ${Object.keys(urls).length} images, e.g. ${urls.hero}`);
  const img: SiteImages = {
    logo: urls.logo, hero: urls.hero, heroMobile: urls.heroMobile, cta: urls.cta, leaf: urls.leaf, videoThumb: urls.videoThumb, favicon: urls.favicon, og: urls.og, scriptFont: urls.scriptFont,
    blog: { listening: urls.blog1, everyday: urls.blog2, resilience: urls.blog3 },
  };

  // ---- pages
  step("Site and pages");
  const { data: orgTemplates } = await Template.query.byOrg({ organizationId }).go({ pages: "all" });
  const roots = orgTemplates.filter((t) => !t.parentId && t.kind === "LANDING_PAGE");
  let root = roots.find((t) => t.name === SITE_NAME) ?? null;
  log(`the workspace has ${roots.length} site(s) (limit ${features.maxLandingPages}); ${root ? `existing "${SITE_NAME}" = ${root.id}` : `"${SITE_NAME}" doesn't exist yet`}`);

  const specs = sitePages(img, { contentBlock });
  const skipped: string[] = [];
  const built: { name: string; id?: string; slug: string; bytes: number }[] = [];

  const compileFor = async (spec: PageSpec, design: V2Design, id: string, parentId: string | null, name: string) => {
    const parsed = parseV2Design(design);
    if (!parsed.ok) throw new Error(`${spec.name}: ${parsed.error}`);
    return parentId
      ? compileTemplateWithSiteLayout({ id, parentId, kind: "LANDING_PAGE", name, designFormat: "v2" }, parsed.design)
      : compileTemplate({ designFormat: "v2", designJson: parsed.design, kind: "LANDING_PAGE", id, name });
  };

  for (const spec of specs) {
    const design = designFor(spec, img);
    if (!spec.isHome && !multiPage) {
      skipped.push(spec.name);
      // still prove it builds, so it is ready for the day the plan allows it
      const html = await compileFor(spec, design, "dry-run", root?.id ?? "dry-run-root", spec.name);
      log(`  ${spec.name}: skipped — needs the Ultra plan (compiles fine, ${(html as string).length} bytes)`);
      continue;
    }
    if (spec.isHome) {
      if (root) {
        const html = await compileFor(spec, design, root.id, null, SITE_NAME);
        if (apply) await Template.patch({ id: root.id }).set({ designFormat: "v2", designJson: design, compiledHtml: html, name: SITE_NAME }).remove(["draftJson", "draftHtml"]).go();
        built.push({ name: spec.name, id: root.id, slug: "/", bytes: html.length });
      } else if (apply) {
        const created = await createV2Page(resolved, { name: SITE_NAME }, { design });
        root = created.row;
        built.push({ name: spec.name, id: created.row.id, slug: "/", bytes: (created.row.compiledHtml ?? "").length });
      } else {
        const html = await compileFor(spec, design, "dry-run-root", null, SITE_NAME);
        built.push({ name: spec.name, slug: "/", bytes: html.length });
      }
      continue;
    }
    // a page of the site (Ultra)
    const existing = root ? orgTemplates.find((t) => t.parentId === root!.id && t.slug === spec.slug) : null;
    if (existing) {
      const html = await compileFor(spec, design, existing.id, root!.id, spec.name);
      if (apply) await Template.patch({ id: existing.id }).set({ designFormat: "v2", designJson: design, compiledHtml: html, name: spec.name }).remove(["draftJson", "draftHtml"]).go();
      built.push({ name: spec.name, id: existing.id, slug: `/${spec.slug}`, bytes: html.length });
    } else if (apply && root) {
      try {
        const created = await createV2Page(resolved, { name: spec.name, siteId: root.id }, { design });
        built.push({ name: spec.name, id: created.row.id, slug: `/${created.slug}`, bytes: (created.row.compiledHtml ?? "").length });
      } catch (err) {
        if (err instanceof PageToolError) { skipped.push(`${spec.name} (${err.message})`); continue; }
        throw err;
      }
    } else {
      const html = await compileFor(spec, design, "dry-run", root?.id ?? "dry-run-root", spec.name);
      built.push({ name: spec.name, slug: `/${spec.slug}`, bytes: html.length });
    }
  }
  for (const b of built) log(`  ${apply ? "✓" : "would build"} ${b.name} ${b.slug} ${b.id ? `(${b.id})` : ""} ${b.bytes} bytes`);
  if (skipped.length) log(`  not built on this plan: ${skipped.join(", ")}`);

  // ---- content types + sample content
  step("Content (videos, stories, happenings)");
  const samples: Record<ContentPresetId, Record<string, unknown>[]> = {
    videos: SAMPLE_VIDEOS(img.videoThumb, img),
    stories: SAMPLE_STORIES(img),
    events: SAMPLE_EVENTS(img),
  };
  if (!root) log("  (dry run: the site doesn't exist yet — content types are created after it)");
  for (const preset of ["videos", "stories", "events"] as const) {
    if (!root) break;
    if (!apply) { log(`  would ensure ${preset} + ${samples[preset].length} sample entries`); continue; }
    const { contentType } = await ensureContentPreset({ templateId: root.id, organizationId, preset });
    const fields = (contentType.fields ?? []) as CustomContentField[];
    const { data: have } = await CustomContentEntry.query.primary({ contentTypeId: contentType.id }).go({ pages: "all" });
    const haveTitles = new Set(have.map((e) => String((e.data as Record<string, unknown>)?.title ?? "")));
    let added = 0;
    for (const sample of samples[preset]) {
      if (haveTitles.has(String(sample.title))) continue;
      const clean = Object.fromEntries(Object.entries(sample).filter(([, v]) => v !== "" && v !== undefined));
      const validated = validateEntryData(fields, clean);
      if ("error" in validated) throw new Error(`${preset} sample "${sample.title}": ${validated.error}`);
      await CustomContentEntry.create({ id: randomUUID(), templateId: root.id, contentTypeId: contentType.id, organizationId, data: validated.data, status: "PUBLISHED" }).go();
      added++;
    }
    log(`  ✓ ${contentType.name}: ${added} sample entr${added === 1 ? "y" : "ies"} added (${have.length} already there)`);
  }

  // ---- blog
  step("Blog");
  if (!root) {
    log("  (dry run: the site doesn't exist yet — the blog is set up after it)");
  } else if (!apply) {
    log(`  would enable the blog, set up the Tolu byline, ${BLOG_POSTS.length} posts and the brand-matched listing + post layouts`);
  } else {
    await ensureBlog(resolved, root.id, img, plan);
  }

  // ---- summary
  step("Done");
  log(apply ? "Nothing was published and no domain was attached." : "Dry run only.");
  if (root) {
    log(`Home / site: ${APP_URL}/dashboard/templates/${root.id}`);
    for (const b of built.filter((x) => x.id && x.slug !== "/")) log(`${b.name}: ${APP_URL}/dashboard/templates/${b.id}`);
  }
}

async function ensureBlog(resolved: ResolvedUser, siteId: string, img: SiteImages, plan: string) {
  const { organizationId, userId } = resolved;
  const layouts = blogLayouts(img);
  const { data: existingBlog } = await BlogSite.get({ templateId: siteId }).go();

  // layout rows (reused when the blog already has them)
  const layoutId = async (kind: "post" | "listing", spec: PageSpec) => {
    const design = designFor(spec, img);
    const parsed = parseV2Design(design);
    if (!parsed.ok) throw new Error(`blog ${kind} layout: ${parsed.error}`);
    let id = kind === "post" ? existingBlog?.postLayoutTemplateId : existingBlog?.listingLayoutTemplateId;
    const html = await compileTemplate({ designFormat: "v2", designJson: parsed.design, kind: "LANDING_PAGE", id: id ?? "new-layout", name: spec.name });
    const marker = kind === "post" ? "content" : "postList";
    if (!hasBlogMarker(html, marker)) throw new Error(`blog ${kind} layout is missing its ${marker} block`);
    if (id) {
      await Template.patch({ id }).set({ designFormat: "v2", designJson: parsed.design, compiledHtml: html }).go();
    } else {
      id = randomUUID();
      await Template.create({ id, userId, organizationId, name: spec.name, kind: "LANDING_PAGE", isBlogLayout: true, designFormat: "v2", designJson: parsed.design, compiledHtml: html }).go();
    }
    return id;
  };
  const postLayoutTemplateId = await layoutId("post", layouts.post);
  const listingLayoutTemplateId = await layoutId("listing", layouts.listing);

  const settings = {
    enabled: true,
    title: "Blog",
    description: "Notes on listening, everyday wisdom and lives of resilience from Echoes of Experience by Tolu.",
    metaTitle: "Blog — Echoes of Experience by Tolu",
    postsPerPage: 9,
    showOnHomepage: false,
    accentColor: "#5d6442",
    fontPreset: "serif",
    postLayoutTemplateId,
    listingLayoutTemplateId,
  };
  if (existingBlog) await BlogSite.patch({ templateId: siteId }).set(settings).go();
  else await BlogSite.create({ id: randomUUID(), templateId: siteId, ...settings }).go();
  log(`  ✓ blog enabled with the Echoes layouts (listing ${listingLayoutTemplateId}, post ${postLayoutTemplateId})`);

  // byline
  const { data: authors } = await BlogAuthor.query.primary({ templateId: siteId }).go({ pages: "all" });
  let author = authors.find((a) => a.name === "Tolu");
  if (!author) {
    const { generateUniqueAuthorSlug } = await import("../../lib/blog/authorsDynamo");
    const slug = await generateUniqueAuthorSlug(siteId, "Tolu");
    await BlogAuthor.create({ id: randomUUID(), templateId: siteId, name: "Tolu", slug, bio: "Tolu hosts Echoes of Experience — honest conversations with remarkable seniors." }).go();
    author = (await BlogAuthor.get({ templateId: siteId, slug }).go()).data!;
  }

  // posts
  const imageFor = { listening: img.blog.listening, everyday: img.blog.everyday, resilience: img.blog.resilience };
  for (const p of BLOG_POSTS) {
    const input = {
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      contentJson: convertWordPressHtmlToTiptapJson(p.html),
      contentHtml: p.html,
      featuredImageUrl: imageFor[p.imageKey],
      featuredImageAlt: p.imageAlt,
      status: "PUBLISHED" as const,
      metaTitle: `${p.title} — Echoes of Experience`,
      metaDescription: p.metaDescription,
      ogImageUrl: imageFor[p.imageKey],
      noindex: false,
      authorId: author.id,
      categoryIds: [] as string[],
      tagIds: [] as string[],
      publishedAtOverride: p.date,
    };
    const { data: existing } = await BlogPost.get({ templateId: siteId, slug: p.slug }).go();
    if (existing) {
      await updateBlogPost(siteId, existing.id, input, async () => {});
      log(`  ✓ post updated: ${p.title}`);
    } else {
      const quota = await assertPublishedBlogPostQuota(siteId, plan);
      if (!quota.ok) throw new Error(quota.error);
      await createBlogPost(siteId, input, async () => {});
      log(`  ✓ post published: ${p.title}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
