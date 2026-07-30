import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

export async function GET() {
  try {
    const dbTestimonials = await prisma.testimonial.findMany({
      where: { status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({ success: true, testimonials: dbTestimonials });
  } catch (error: any) {
    console.error("[TESTIMONIALS_GET_ERROR]", error);
    return NextResponse.json({ success: true, testimonials: [] });
  }
}
