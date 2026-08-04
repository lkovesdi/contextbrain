"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type Release =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; url: string; version: string; size: string };

// Hits the GitHub release API to find the latest signed .dmg. If no release
// exists yet (pre-v0.1.0) the API returns 404; the "none" branch handles it
// gracefully.
const RELEASES_API =
  "https://api.github.com/repos/lkovesdi/contextbrain/releases/latest";

export function DownloadCard() {
  const [release, setRelease] = useState<Release>({ kind: "loading" });

  useEffect(() => {
    fetch(RELEASES_API)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) {
          setRelease({ kind: "none" });
          return;
        }
        const asset = (data.assets as { name: string; size: number; browser_download_url: string }[] | undefined)?.find(
          (a) => a.name.endsWith(".dmg")
        );
        if (!asset) {
          setRelease({ kind: "none" });
          return;
        }
        setRelease({
          kind: "ready",
          url: asset.browser_download_url,
          version: data.tag_name,
          size: `${Math.round(asset.size / (1024 * 1024))} MB`,
        });
      })
      .catch(() => setRelease({ kind: "none" }));
  }, []);

  if (release.kind === "loading") {
    return (
      <div className="rounded-[12px] border border-float-border bg-float-ink/[0.03] p-6 text-center text-[14px] text-float-ink-2">
        Checking for the latest version…
      </div>
    );
  }

  if (release.kind === "none") {
    return (
      <div className="flex flex-col gap-3 rounded-[12px] border border-float-border bg-float-ink/[0.03] p-6 text-center">
        <p className="m-0 text-[14px] text-float-ink">Coming soon.</p>
        <p className="m-0 text-[12px] text-float-ink-2">
          The Mac app is in private testing. The web app has every feature in the meantime.
        </p>
      </div>
    );
  }

  return (
    <a
      href={release.url}
      className="group flex cursor-pointer items-center justify-between rounded-[12px] border border-float-border bg-float-ink/[0.03] p-6 transition-colors hover:bg-float-ink/[0.06]"
    >
      <div className="flex flex-col gap-1 text-left">
        <span className="text-[15px] font-medium text-float-ink">
          Download {release.version}
        </span>
        <span className="text-[12px] text-float-ink-2">.dmg · {release.size}</span>
      </div>
      <Download
        className="text-float-accent transition-transform group-hover:translate-y-0.5"
        size={22}
      />
    </a>
  );
}
