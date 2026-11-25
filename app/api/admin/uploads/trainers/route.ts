import { NextRequest, NextResponse } from "next/server";
import { assertAdminRequest } from "@/lib/admin-auth";
import { allowedImageTypes, isAllowedImage, maxImageBytes, saveUploadedImage } from "@/lib/image-upload";
import { readRequestBody, secureResponse, validationErrorResponse } from "@/lib/security";

export async function POST(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;

  let data: FormData;
  try {
    const bytes = await readRequestBody(request, maxImageBytes + 64 * 1024);
    data = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
  } catch (error) {
    if (error instanceof TypeError) return secureResponse(NextResponse.json({ message: "Invalid upload" }, { status: 400 }));
    return validationErrorResponse(error);
  }
  const file = data.get("file");
  if (!(file instanceof File)) return secureResponse(NextResponse.json({ message: "Missing file" }, { status: 400 }));
  if (!allowedImageTypes.has(file.type)) return secureResponse(NextResponse.json({ message: "Only JPG, PNG, or WEBP images are allowed" }, { status: 415 }));
  if (file.size > maxImageBytes) return secureResponse(NextResponse.json({ message: "Image must be 3MB or smaller" }, { status: 413 }));

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isAllowedImage(bytes, file.type)) {
    return secureResponse(NextResponse.json({ message: "Invalid image file" }, { status: 415 }));
  }
  return secureResponse(NextResponse.json({ imageUrl: await saveUploadedImage("trainers", bytes, file.type) }));
}
