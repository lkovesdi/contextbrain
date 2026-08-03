import { getSettingsStatus } from "@/lib/settings";
import { SettingsPanel } from "./SettingsPanel";
import { PageHeading, PageSubhead } from "@/components/ui/typography";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getSettingsStatus();
  return (
    <div className="mx-auto w-full max-w-[720px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Settings</PageHeading>
        <PageSubhead>
          Bring your own API keys. When a key is set and enabled it runs your
          calls on your billing; otherwise ContextBrain&apos;s platform key is used.
        </PageSubhead>
      </header>
      <SettingsPanel initial={status} />
    </div>
  );
}
