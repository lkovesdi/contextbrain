"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button
      onClick={signOut}
      className="text-left text-[11.5px] text-slate hover:text-ink transition-colors p-0 bg-transparent border-0 cursor-pointer font-sans"
    >
      Sign out
    </button>
  );
}
