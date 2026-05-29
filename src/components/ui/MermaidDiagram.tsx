"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

// Mermaid is ~200KB minified — we dynamic-import it on demand so only pages
// that actually render a diagram pay the cost. Module-cached after first load.
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        themeVariables: {
          // Calm — pulled from our design tokens so diagrams blend with the
          // surrounding markdown instead of shouting in mermaid pink.
          fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
          background: "#FFFFFF",
          primaryColor: "#E7E7FB",
          primaryTextColor: "#1B1A85",
          primaryBorderColor: "#4B49E6",
          secondaryColor: "#F8F7F4",
          tertiaryColor: "#ECEBE6",
          lineColor: "#5A5B62",
          textColor: "#14151A",
          mainBkg: "#E7E7FB",
          edgeLabelBackground: "#FFFFFF",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let idCounter = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setError(null);
      setSvg(null);
      try {
        const mermaid = await loadMermaid();
        // ID needs to be unique per render to avoid mermaid caching collisions.
        const id = `mb-mermaid-${++idCounter}`;
        const result = await mermaid.render(id, code);
        if (cancelled) return;
        setSvg(result.svg);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Diagram failed to render";
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="my-3 rounded-[8px] border border-amber bg-amber-tint p-3 text-[12px] text-amber-ink">
        <div className="flex items-center gap-2 font-mono uppercase tracking-[0.06em] text-[10.5px] mb-2">
          <AlertTriangle size={12} strokeWidth={1.6} />
          Diagram failed to render
        </div>
        <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
          {code}
        </pre>
        <div className="mt-2 text-[10.5px] opacity-80">{error}</div>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-[8px] border border-mist bg-paper-2 p-4 text-[12px] text-slate min-h-[80px]">
        <Loader2 size={14} strokeWidth={1.6} className="animate-spin text-slate-2" />
        <span className="font-mono uppercase tracking-[0.06em] text-[10.5px]">
          Rendering diagram…
        </span>
      </div>
    );
  }
  return (
    <div
      className="my-3 rounded-[8px] border border-mist bg-bone-2 p-4 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
