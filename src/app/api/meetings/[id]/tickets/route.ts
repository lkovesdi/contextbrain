import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { createIssue as createJiraIssue } from "@/lib/jira";
import { createIssue as createLinearIssue } from "@/lib/linear";

export const dynamic = "force-dynamic";

const TicketType = z.enum(["story", "task", "bug", "epic"]);
const TicketPriority = z.enum(["urgent", "high", "medium", "low", "none"]);

const Common = z.object({
  title: z.string().min(2).max(200),
  description: z.string().min(1),
  type: TicketType,
  priority: TicketPriority.optional(),
  suggested_owner: z.string().nullable().optional(),
  // The suggestion's title at the time of creation. Stored so we can render
  // "Created → KEY-123" on the matching suggestion card after regenerate.
  suggestion_title: z.string().nullable().optional(),
});

const JiraBody = Common.extend({
  provider: z.literal("jira"),
  project_key: z.string().min(1),
});

const LinearBody = Common.extend({
  provider: z.literal("linear"),
  team_id: z.string().min(1),
  project_id: z.string().optional(),
});

const Body = z.discriminatedUnion("provider", [JiraBody, LinearBody]);

// GET — list created tickets for this meeting, for the UI to mark cards as
// already-created. Returned shape matches the meeting_tickets row.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("meeting_tickets")
    .select("id,provider,external_key,external_url,title,suggestion_title,created_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tickets: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ensure the meeting is owned by this user — the explicit check is cheap
  // and gives a clearer 404 than relying solely on RLS silently filtering.
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .single();
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof z.ZodError ? e.issues : "Invalid request" },
      { status: 400 }
    );
  }

  if (!(await findActiveConnection(user.id, body.provider))) {
    return NextResponse.json(
      { error: `${body.provider} not connected` },
      { status: 412 }
    );
  }

  let created;
  try {
    if (body.provider === "jira") {
      created = await createJiraIssue(user.id, {
        title: body.title,
        description: body.description,
        type: body.type,
        priority: body.priority,
        suggestedOwner: body.suggested_owner ?? null,
        projectKey: body.project_key,
      });
    } else {
      created = await createLinearIssue(user.id, {
        title: body.title,
        description: body.description,
        type: body.type,
        priority: body.priority,
        suggestedOwner: body.suggested_owner ?? null,
        teamId: body.team_id,
        projectId: body.project_id,
      });
    }
  } catch (e) {
    console.error(`[tickets] ${body.provider} create failed`, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create failed" },
      { status: 502 }
    );
  }

  const { data: row, error: insertErr } = await supabase
    .from("meeting_tickets")
    .insert({
      meeting_id: meetingId,
      user_id: user.id,
      provider: created.provider,
      external_key: created.key,
      external_url: created.url,
      title: body.title,
      suggestion_title: body.suggestion_title ?? body.title,
    })
    .select("id,provider,external_key,external_url,title,suggestion_title,created_at")
    .single();
  if (insertErr) {
    // Issue was created in the external system but DB insert failed — surface
    // both so the user knows the ticket exists upstream.
    return NextResponse.json(
      {
        warning:
          "Ticket created in " + created.provider + " but failed to record locally: " + insertErr.message,
        ticket: created,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({ ticket: row });
}
