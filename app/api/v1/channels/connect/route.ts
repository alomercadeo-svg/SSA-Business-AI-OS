import { NextRequest, NextResponse } from "next/server";
import { requireManager } from "@/lib/workspace";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/vault";
import { PLATFORMS, isSupportedPlatform } from "@/lib/platforms";

/**
 * POST /api/v1/channels/connect
 *
 * Returns Zernio's OAuth/connect URL for the given platform.
 * Zernio handles the entire connection flow (OAuth, page selection, etc.)
 * and redirects back to our callback URL when done.
 */
export async function POST(request: NextRequest) {
  const { contexto, error: authError } = await requireManager();
  if (authError) return authError;
  const { workspace, supabase } = contexto;

  const apiKey = await getZernioApiKey(supabase, workspace.id);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Zernio API key not configured. Go to Settings first." },
      { status: 400 }
    );
  }

  const { platform } = await request.json();

  if (!isSupportedPlatform(platform)) {
    return NextResponse.json(
      { error: `Unsupported platform. Must be one of: ${PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }

  const zernio = createZernioClient(apiKey);

  try {
    // Get profile ID (required by Zernio's connect endpoint)
    const profilesRes = await zernio.profiles.listProfiles();
    const profiles = profilesRes.data?.profiles ?? [];
    if (profiles.length === 0) {
      return NextResponse.json(
        { error: "No Zernio profiles found. Create one in your Zernio dashboard first." },
        { status: 400 }
      );
    }

    const profileId = profiles[0]._id!;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const callbackUrl = `${appUrl}/dashboard/channels/callback`;

    // Zernio handles everything: OAuth, page selection, Bluesky credentials, Telegram code
    const res = await zernio.connect.getConnectUrl({
      path: { platform },
      query: { profileId, redirect_url: callbackUrl },
    });

    if (!res.data?.authUrl) {
      return NextResponse.json({ error: "Failed to get connect URL" }, { status: 500 });
    }

    return NextResponse.json({ authUrl: res.data.authUrl });
  } catch (error) {
    console.error("Failed to get connect URL:", error);
    return NextResponse.json(
      { error: `Connection failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
