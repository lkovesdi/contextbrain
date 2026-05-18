import { createClient } from "@/lib/supabase/server";
import { IntegrationCard } from "./IntegrationCard";
import { Eyebrow, PageHeading, PageSubhead } from "@/components/ui/typography";

export const dynamic = "force-dynamic";

const PROVIDERS = [
  {
    id: "github",
    label: "GitHub",
    description: "Search issues & pull requests.",
    logo: "GH",
    bg: "#14151A",
  },
  {
    id: "jira",
    label: "Jira",
    description: "Search tickets across your projects.",
    logo: "JI",
    bg: "#0052CC",
  },
  {
    id: "figma",
    label: "Figma",
    description: "Search files in your team.",
    logo: "FI",
    bg: "#F24E1E",
  },
  {
    id: "linear",
    label: "Linear",
    description: "Pull recent issues across your workspace.",
    logo: "LN",
    bg: "#5E6AD2",
  },
] as const;

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("integrations")
    .select("provider,metadata,connected_at");
  const byProvider = new Map((rows ?? []).map((r) => [r.provider, r] as const));

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Integrations</PageHeading>
        <PageSubhead>
          Connect external tools so MeetingBrain can pull relevant context into chat.
        </PageSubhead>
      </header>

      <Eyebrow className="mb-[10px]">Connections · {PROVIDERS.length}</Eyebrow>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[14px]">
        {PROVIDERS.map((p) => {
          const row = byProvider.get(p.id);
          const status = (row?.metadata as { status?: string } | undefined)?.status ?? null;
          const connected = !!row && status !== "pending";
          return (
            <IntegrationCard
              key={p.id}
              provider={p.id}
              label={p.label}
              description={p.description}
              logo={p.logo}
              logoBg={p.bg}
              connected={connected}
              pending={status === "pending"}
            />
          );
        })}
      </div>
    </div>
  );
}
