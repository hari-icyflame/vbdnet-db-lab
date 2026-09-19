import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import FormData from "form-data";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get("file") as File;
    const tileIndexesRaw = formData.get("tileIndexes") as string;
    const ownerName = formData.get("ownerName") as string;
    const websiteUrl = formData.get("websiteUrl") as string;

    if (!file) {
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    if (!tileIndexesRaw) {
      return NextResponse.json(
        { error: "No tiles selected" },
        { status: 400 }
      );
    }

    let tileIndexes: number[];

    try {
      tileIndexes = JSON.parse(tileIndexesRaw);
    } catch {
      return NextResponse.json(
        { error: "Invalid tile selection" },
        { status: 400 }
      );
    }

    if (
      !Array.isArray(tileIndexes) ||
      tileIndexes.length === 0 ||
      !tileIndexes.every((index) => Number.isInteger(index))
    ) {
      return NextResponse.json(
        { error: "Invalid tile selection" },
        { status: 400 }
      );
    }

    // Prevent selecting the same tile more than once
    tileIndexes = [...new Set(tileIndexes)];

    // Check whether any selected tile is already claimed
    const { data: existingTiles, error: checkError } = await supabase
      .from("tiles")
      .select("tile_index")
      .in("tile_index", tileIndexes);

    if (checkError) {
      throw new Error(
        `Database check failed: ${checkError.message}`
      );
    }

    if (existingTiles && existingTiles.length > 0) {
      const claimedIndexes = existingTiles.map(
        (tile) => tile.tile_index
      );

      return NextResponse.json(
        {
          error: `These tiles are already claimed: ${claimedIndexes.join(
            ", "
          )}`,
        },
        { status: 409 }
      );
    }

    // Convert image to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Sightengine moderation
    const moderationData = new FormData();

    moderationData.append("media", buffer, {
      filename: file.name,
      contentType: file.type,
    });

    moderationData.append(
      "models",
      "nudity-2.1,offensive,violence"
    );

    moderationData.append(
      "api_user",
      process.env.SIGHTENGINE_API_USER!
    );

    moderationData.append(
      "api_secret",
      process.env.SIGHTENGINE_API_SECRET!
    );

    const moderationResponse = await axios.post(
      "https://api.sightengine.com/1.0/check.json",
      moderationData,
      {
        headers: moderationData.getHeaders(),
      }
    );

    const moderation = moderationResponse.data;

    console.log("SIGHTENGINE RESPONSE:", moderation);

    if (moderation.status !== "success") {
      throw new Error(
        moderation.error?.message ||
          "Sightengine moderation failed"
      );
    }

    // Reject inappropriate content
    if (
      moderation.nudity?.sexual_activity > 0.5 ||
      moderation.nudity?.sexual_display > 0.5 ||
      moderation.offensive?.prob > 0.5 ||
      moderation.violence?.prob > 0.5
    ) {
      return NextResponse.json(
        {
          error:
            "Image was rejected by content moderation.",
        },
        { status: 400 }
      );
    }

    // Upload one copy of the image to Storage
    const safeFileName = file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    const fileName = `${Date.now()}-${safeFileName}`;

    const { error: storageError } = await supabase.storage
      .from("tile-images")
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (storageError) {
      throw new Error(
        `Storage upload failed: ${storageError.message}`
      );
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("tile-images")
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;

    // Create a database record for every selected tile
    const tileRows = tileIndexes.map((tileIndex) => ({
      tile_index: tileIndex,
      image_url: imageUrl,
      owner_name: ownerName,
      website_url: websiteUrl,
    }));

    const { data: tiles, error: insertError } = await supabase
      .from("tiles")
      .insert(tileRows)
      .select();

    if (insertError) {
      throw new Error(
        `Database insert failed: ${insertError.message}`
      );
    }

    return NextResponse.json({
      success: true,
      tiles,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed",
      },
      { status: 500 }
    );
  }
}