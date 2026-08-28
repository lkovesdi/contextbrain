import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_PATH_RE,
  mediaTypeForPath,
} from "@/lib/chat-attachments";

// Serves a stored chat image to its owner. Stable URLs (unlike signed ones)
// so chat history can embed them directly; the bucket is private and its RLS
// keys on the `<user_id>/` prefix, which we also check up front.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const key = path.map(decodeURIComponent).join("/");
  if (!ATTACHMENT_PATH_RE.test(key)) {
    return new Response("Bad path", { status: 400 });
  }

  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!key.startsWith(`${user.id}/`)) {
    return new Response("Not found", { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .download(key);
  if (error || !data) return new Response("Not found", { status: 404 });

  return new Response(data, {
    headers: {
      "Content-Type": data.type || mediaTypeForPath(key),
      // Object keys are UUIDs and never rewritten — safe to cache per user.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
