import { docClient, TABLES } from "@/lib/db/client";
import { BlogComment, BlogSite } from "@/lib/db/contentEntities";
import { CommerceDonationSubscription, CommerceProductRelation, CommerceSettings } from "@/lib/db/commerceEntities";
import { FormSettings } from "@/lib/db/opsEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { deleteObjects } from "@/lib/storage";

// Deleting a site deletes what it owns — its blog, shop catalogue, settings, form
// submissions, imports — not just its pages. Nearly everything a site owns lives in its
// own partition (template#<siteId>) in the content, commerce, ops and import tables, so
// each partition is swept whole: whatever kinds of data a site gains later go too.
//
// Kept on purpose: orders, order items and bookings are financial records (payouts,
// refunds, tax) and stay for the organization. The site's own record, files and domains
// are removed by the delete route itself, which needs them to clean up storage and
// CloudFront first.

/**
 * A partition's key exactly as ElectroDB stores it (it lowercases keys: "template#<id>",
 * not the "TEMPLATE#<id>" its templates read like) — taken from the entity itself, never
 * written by hand.
 */
function partitionKey(query: { params: () => Record<string, unknown> }): string {
  const values = query.params().ExpressionAttributeValues as Record<string, unknown> | undefined;
  const pk = values?.[":pk"];
  if (typeof pk !== "string") throw new Error("Couldn't work out where this site's data is stored.");
  return pk;
}

/** The site's partition in each table, and the two kinds kept under other keys. */
export const siteKeys = {
  content: (templateId: string) => partitionKey(BlogSite.query.primary({ templateId })),
  commerce: (templateId: string) => partitionKey(CommerceSettings.query.primary({ templateId })),
  ops: (templateId: string) => partitionKey(FormSettings.query.primary({ templateId })),
  import: (templateId: string) => partitionKey(WpMigrationJob.query.primary({ templateId })),
  postComments: (postId: string) => partitionKey(BlogComment.query.primary({ postId })),
  productRelations: (productId: string) => partitionKey(CommerceProductRelation.query.primary({ productId })),
};

const KEEP = new Set(["commerceOrder", "commerceOrderItem", "commerceBooking", "template", "templateAsset", "publishedDomain"]);

type Row = { pk: string; sk: string; __edb_e__?: string; id?: string; blobUrl?: string };

async function partition(table: string, pk: string): Promise<Row[]> {
  const rows: Row[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await docClient.query({
      TableName: table,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      ProjectionExpression: "pk, sk, #e, id, blobUrl",
      ExpressionAttributeNames: { "#e": "__edb_e__" },
      ExclusiveStartKey: start,
    });
    rows.push(...((res.Items ?? []) as Row[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return rows;
}

async function removeRows(table: string, rows: Row[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 25) {
    let requests: Record<string, unknown>[] = rows.slice(i, i + 25).map((r) => ({ DeleteRequest: { Key: { pk: r.pk, sk: r.sk } } }));
    for (let attempt = 0; requests.length > 0 && attempt < 8; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      const res = await docClient.batchWrite({ RequestItems: { [table]: requests as never } });
      requests = (res.UnprocessedItems?.[table] as Record<string, unknown>[] | undefined) ?? [];
    }
    if (requests.length > 0) throw new Error("Couldn't finish deleting this site's data — try again in a minute.");
  }
  return rows.length;
}

/** Why this site can't be deleted yet, in plain words — or null when it can. */
export async function siteDeletionBlocker(templateId: string): Promise<string | null> {
  const { data: subs } = await CommerceDonationSubscription.query.primary({ templateId }).go({ pages: "all" });
  const active = subs.filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE").length;
  if (active > 0) {
    return `This site has ${active} monthly donor${active === 1 ? "" : "s"}. Cancel their monthly gifts in Commerce → Donations first, so nobody keeps being charged for a site that's gone — then delete it.`;
  }
  return null;
}

/** Layout pages (blog listing/post, product detail) the site uses but that sit outside its page tree. */
export async function siteLayoutTemplateIds(templateId: string): Promise<string[]> {
  const [{ data: blog }, { data: commerce }] = await Promise.all([BlogSite.get({ templateId }).go(), CommerceSettings.get({ templateId }).go()]);
  const ids = [blog?.listingLayoutTemplateId, blog?.postLayoutTemplateId, (commerce as { productDetailTemplateId?: string } | null)?.productDetailTemplateId];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id !== templateId)));
}

/**
 * Removes everything a site owns except its financial records (see top). `pageIds` are the
 * site's other pages, whose own partitions (revisions, page-level data) go too.
 */
export async function purgeSiteData(templateId: string, pageIds: string[] = []): Promise<{ removed: number }> {
  let removed = 0;
  const postIds: string[] = [];
  const productIds: string[] = [];
  const blobUrls: string[] = [];

  const tables: [string, (id: string) => string][] = [
    [TABLES.content, siteKeys.content],
    [TABLES.commerce, siteKeys.commerce],
    [TABLES.ops, siteKeys.ops],
    [TABLES.import, siteKeys.import],
  ];
  for (const [table, keyOf] of tables) {
    const rows = (await partition(table, keyOf(templateId))).filter((r) => !KEEP.has(r.__edb_e__ ?? ""));
    for (const r of rows) {
      if (r.__edb_e__ === "blogPost" && r.id) postIds.push(r.id);
      if (r.__edb_e__ === "commerceProduct" && r.id) productIds.push(r.id);
      // Images re-hosted by a blog import or WordPress migration (lib/blogImport/mediaRehostDynamo.ts).
      if (r.__edb_e__ === "importMediaMap" && r.blobUrl) blobUrls.push(r.blobUrl);
    }
    removed += await removeRows(table, rows);
  }
  for (const pageId of pageIds) {
    removed += await removeRows(TABLES.content, (await partition(TABLES.content, siteKeys.content(pageId))).filter((r) => !KEEP.has(r.__edb_e__ ?? "")));
  }
  // Kept under their own keys: each post's comments, each product's related-product links.
  for (const id of postIds) removed += await removeRows(TABLES.content, await partition(TABLES.content, siteKeys.postComments(id)));
  for (const id of productIds) removed += await removeRows(TABLES.commerce, await partition(TABLES.commerce, siteKeys.productRelations(id)));
  if (blobUrls.length > 0) {
    await deleteObjects(blobUrls).catch((err) => console.error("[sites] couldn't delete a deleted site's imported images (non-fatal):", err));
  }
  return { removed };
}
