import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { verifyModerationToken } from "@/lib/email";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const action = searchParams.get("action") as "approve" | "reject" | null;
  const token = searchParams.get("token");

  if (!id || !action || !token || (action !== "approve" && action !== "reject")) {
    return new NextResponse(
      renderHtmlCard("Invalid Moderation Request", "Missing or invalid query parameters.", false),
      { headers: { "content-type": "text/html" }, status: 400 }
    );
  }

  // Verify HMAC token
  const isValid = verifyModerationToken(id, action, token);
  if (!isValid) {
    return new NextResponse(
      renderHtmlCard("Security Check Failed", "The moderation token provided is invalid or expired.", false),
      { headers: { "content-type": "text/html" }, status: 403 }
    );
  }

  try {
    const testimonial = await prisma.testimonial.findUnique({ where: { id } });

    if (!testimonial) {
      return new NextResponse(
        renderHtmlCard("Not Found", "The requested testimonial could not be found.", false),
        { headers: { "content-type": "text/html" }, status: 404 }
      );
    }

    const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
    await prisma.testimonial.update({
      where: { id },
      data: { status: newStatus },
    });

    const isApprove = action === "approve";
    const title = isApprove ? "Testimonial Approved & Live! 🎉" : "Testimonial Rejected ✖";
    const message = isApprove
      ? `The review from <strong>${testimonial.name}</strong> (${testimonial.role}) is now approved and live on the Plexo landing page.`
      : `The review from <strong>${testimonial.name}</strong> has been rejected and will not be displayed on the website.`;

    return new NextResponse(renderHtmlCard(title, message, true), {
      headers: { "content-type": "text/html" },
    });
  } catch (error: any) {
    console.error("[MODERATE_ERROR]", error);
    return new NextResponse(
      renderHtmlCard("Error Processing Request", error?.message || "An unexpected error occurred.", false),
      { headers: { "content-type": "text/html" }, status: 500 }
    );
  }
}

function renderHtmlCard(title: string, bodyText: string, isSuccess: boolean): string {
  const icon = isSuccess ? "✔" : "✖";
  const iconColor = isSuccess ? "#10b981" : "#ef4444";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title} | Plexo Admin Moderation</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Mulish:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Mulish', sans-serif;
            background-color: #0b0f19;
            color: #ffffff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
          }
          .card {
            background-color: #121724;
            border: 1px solid #1e293b;
            border-radius: 28px;
            padding: 48px 36px;
            max-width: 480px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.6);
          }
          .icon-badge {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background-color: rgba(255,255,255,0.05);
            color: ${iconColor};
            border: 2px solid ${iconColor};
            font-size: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px auto;
          }
          h1 {
            font-size: 24px;
            font-weight: 800;
            margin-bottom: 12px;
            letter-spacing: -0.02em;
          }
          p {
            font-size: 15px;
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 32px;
          }
          .btn {
            display: inline-block;
            background-color: #6b3bf9;
            color: #ffffff;
            font-weight: 800;
            text-decoration: none;
            padding: 14px 28px;
            border-radius: 16px;
            font-size: 14px;
            transition: background-color 0.2s;
          }
          .btn:hover {
            background-color: #5b2be6;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-badge">${icon}</div>
          <h1>${title}</h1>
          <p>${bodyText}</p>
          <a href="/" class="btn">Return to Plexo Landing Page</a>
        </div>
      </body>
    </html>
  `;
}
