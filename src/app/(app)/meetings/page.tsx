import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { NewMeetingButton } from "../NewMeetingButton";
import { MeetingsBrowser } from "../MeetingsBrowser";
import { PageHeading, PageSubhead } from "@/components/ui/typography";
import { loadMeetings } from "@/lib/meetings";

export const dynamic = "force-dynamic";

type Space = { id: string; name: string; icon: string | null };

export default async function MeetingsPage() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);

  const [firstPage, { data: presets }, { data: spaces }] = await Promise.all([
    user
      ? loadMeetings(supabase, user.id, {})
      : Promise.resolve({ items: [], nextCursor: null }),
    supabase.from("context_presets").select("id,name").order("created_at", { ascending: false }),
    supabase.from("spaces").select("id,name,icon").order("name"),
  ]);

  const spaceList = (spaces ?? []) as Space[];

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-9 flex items-start justify-between gap-4">
        <div>
          <PageHeading>Meetings</PageHeading>
          <PageSubhead>Capture, structure, and chat with your meetings.</PageSubhead>
        </div>
        <NewMeetingButton presets={presets ?? []} />
      </header>

      <MeetingsBrowser
        initialItems={firstPage.items}
        initialNextCursor={firstPage.nextCursor}
        spaces={spaceList}
      />
    </div>
  );
}
