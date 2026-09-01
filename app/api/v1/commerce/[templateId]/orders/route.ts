import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";

const PAGE_SIZE = 25;

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const fulfillmentStatus = searchParams.get("fulfillmentStatus");
  const q = searchParams.get("q")?.trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const where = {
    templateId,
    ...(status ? { status: status as never } : {}),
    ...(fulfillmentStatus ? { fulfillmentStatus: fulfillmentStatus as never } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" as const } },
            { customerEmail: { contains: q, mode: "insensitive" as const } },
            { customerName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.commerceOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        items: { select: { nameSnapshot: true, quantity: true, unitPriceMinor: true } },
        booking: { select: { scheduledStart: true, status: true } },
        digitalDeliveries: {
          select: { id: true, method: true, deliveredAt: true, downloadCount: true, maxDownloads: true, resendCount: true, product: { select: { name: true } } },
        },
      },
    }),
    prisma.commerceOrder.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pageSize: PAGE_SIZE });
}
