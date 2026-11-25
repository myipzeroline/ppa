import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { allowedImageTypes, isAllowedImage, maxImageBytes, removeUploadedImage, saveUploadedImage } from "@/lib/image-upload";
import { assertSameOrigin, checkRateLimit, clientIp, readRequestBody, secureResponse, validationErrorResponse } from "@/lib/security";

// The group photo (แตะเพื่อใส่รูปกลุ่ม): the owner uploads it after creating the group, or changes it on
// the group page. The app shrinks the photo on the phone first (JPEG, at most 1024 px); the server
// checks the file itself and stores it under a new name. Staff can remove it in the back office.
export async function POST(req: Request) {
  const crossOrigin = assertSameOrigin(req);
  if (crossOrigin) return crossOrigin;
  const crowded = checkRateLimit({ key: `group-photo:${await clientIp()}`, limit: 60, windowMs: 60_000 });
  if (crowded) return crowded;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const limited = checkRateLimit({ key: `group-photo:member:${user.id}`, limit: 10, windowMs: 60 * 60_000 });
  if (limited) return limited;

  let data: FormData;
  try {
    const bytes = await readRequestBody(req, maxImageBytes + 64 * 1024);
    data = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": req.headers.get("content-type") || "" } }).formData();
  } catch (error) {
    if (error instanceof TypeError) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
    return validationErrorResponse(error);
  }
  const groupId = Number(data.get("groupId"));
  const file = data.get("file");
  if (!Number.isSafeInteger(groupId) || groupId <= 0 || !(file instanceof File)) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  if (!allowedImageTypes.has(file.type)) return secureResponse(NextResponse.json({ message: "ใช้รูป JPG, PNG หรือ WEBP เท่านั้น" }, { status: 415 }));
  if (file.size > maxImageBytes) return secureResponse(NextResponse.json({ message: "รูปต้องมีขนาดไม่เกิน 3 MB" }, { status: 413 }));
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isAllowedImage(bytes, file.type)) return secureResponse(NextResponse.json({ message: "ใช้รูป JPG, PNG หรือ WEBP เท่านั้น" }, { status: 415 }));

  const [group] = await query<{ id: number; photoUrl: string | null }>("SELECT id, photo_url photoUrl FROM groups_clubs WHERE id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1", [groupId, user.id]);
  if (!group) return secureResponse(NextResponse.json({ message: "เปลี่ยนรูปได้เฉพาะผู้จัดก๊วน" }, { status: 403 }));
  const photoUrl = await saveUploadedImage("groups", bytes, file.type);
  const result = (await query("UPDATE groups_clubs SET photo_url = ? WHERE id = ? AND owner_user_id = ? AND status = 'active'", [photoUrl, groupId, user.id])) as unknown as { affectedRows?: number };
  if (!result.affectedRows) {
    await removeUploadedImage("groups", photoUrl);
    return secureResponse(NextResponse.json({ message: "เปลี่ยนรูปได้เฉพาะผู้จัดก๊วน" }, { status: 403 }));
  }
  await removeUploadedImage("groups", group.photoUrl);
  return secureResponse(NextResponse.json({ photoUrl }));
}
