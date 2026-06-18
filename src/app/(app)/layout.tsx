import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "./Sidebar";
import { ConfirmProvider } from "@/components/ui/ConfirmModal";
import { DesktopAppPrompt } from "@/components/ui/DesktopAppPrompt";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organizations(name)")
    .eq("user_id", user.id)
    .maybeSingle();
  const orgRel = membership?.organizations as
    | { name: string }
    | { name: string }[]
    | null
    | undefined;
  const orgName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? null;

  return (
    <ConfirmProvider>
      <div className="flex min-h-screen bg-paper text-ink">
        <Sidebar userEmail={user.email ?? ""} orgName={orgName} />
        <main className="flex-1 min-w-0 flex flex-col">
          <DesktopAppPrompt />
          {children}
        </main>
      </div>
    </ConfirmProvider>
  );
}
