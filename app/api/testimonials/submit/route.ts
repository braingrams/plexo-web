import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { sendTestimonialNotificationEmail } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, role, company, quote, rating, avatarUrl } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Name is required." }, { status: 400 });
    }

    if (!role || typeof role !== "string" || role.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Role/Title is required." }, { status: 400 });
    }

    if (!quote || typeof quote !== "string" || quote.trim().length < 10) {
      return NextResponse.json(
        { success: false, error: "Quote must be at least 10 characters long." },
        { status: 400 }
      );
    }

    const numericRating = Math.min(5, Math.max(1, Number(rating) || 5));

    // Save testimonial as PENDING
    const testimonial = await prisma.testimonial.create({
      data: {
        name: name.trim(),
        role: role.trim(),
        company: company ? String(company).trim() : null,
        quote: quote.trim(),
        rating: numericRating,
        avatarUrl: avatarUrl ? String(avatarUrl).trim() : null,
        status: "PENDING",
      },
    });

    // Send email notification to ADMIN_EMAIL with 1-click approve/reject links
    await sendTestimonialNotificationEmail({
      id: testimonial.id,
      name: testimonial.name,
      role: testimonial.role,
      company: testimonial.company,
      quote: testimonial.quote,
      rating: testimonial.rating,
      avatarUrl: testimonial.avatarUrl,
    });

    return NextResponse.json({
      success: true,
      message: "Testimonial submitted successfully! It will be reviewed by the admin.",
      id: testimonial.id,
    });
  } catch (error: any) {
    console.error("[TESTIMONIAL_SUBMIT_ERROR]", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to submit testimonial." },
      { status: 500 }
    );
  }
}
