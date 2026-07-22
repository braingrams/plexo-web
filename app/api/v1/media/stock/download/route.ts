import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "../../../domains/route";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveUser(request);
    if (!resolved) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { downloadLocation } = await request.json();
    if (!downloadLocation) {
      return NextResponse.json({ error: "Missing downloadLocation" }, { status: 400 });
    }

    const unsplashKey = request.headers.get("x-unsplash-key") || process.env.UNSPLASH_ACCESS_KEY;
    if (unsplashKey) {
      // Fire-and-forget download tracking request to Unsplash
      fetch(downloadLocation, {
        headers: {
          Authorization: `Client-ID ${unsplashKey}`,
        },
      }).catch((err) => {
        console.warn("Unsplash download tracking API failed:", err);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to proxy download tracking:", error);
    return NextResponse.json({ error: "Failed to proxy download tracking" }, { status: 500 });
  }
}
