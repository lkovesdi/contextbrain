import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "./Sidebar";
import { ConfirmProvider } from "@/components/ui/ConfirmModal";

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

  return (
    <ConfirmProvider>
      <div className="flex min-h-screen bg-paper text-ink">
        <Sidebar userEmail={user.email ?? ""} />
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
      </div>
    </ConfirmProvider>
  );
}
