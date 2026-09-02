import { NextResponse } from "next/server";
import { Testimonial } from "@/lib/db/contentEntities";

export async function GET() {
  try {
    const { data: dbTestimonials } = await Testimonial.query
      .byStatus({ status: "APPROVED" })
      .go({ order: "desc", limit: 20 });

    return NextResponse.json({ success: true, testimonials: dbTestimonials });
  } catch (error: any) {
    console.error("[TESTIMONIALS_GET_ERROR]", error);
    return NextResponse.json({ success: true, testimonials: [] });
  }
}
