"use client";

import { useState } from "react";
import { GitBranch, HelpCircle } from "lucide-react";
import { Eyebrow } from "@/components/ui/typography";
import { Tabs } from "@/components/ui/Tabs";
import { SummaryMarkdown } from "@/components/ui/SummaryMarkdown";
import type { PrdArtifact } from "@/lib/prd";

// The PRD-mode artifact: one plan, two renditions (PM / engineering), plus
// the open questions the pipeline deliberately left for humans.
export function PrdSection({ prd }: { prd: PrdArtifact }) {
  const [view, setView] = useState<"pm" | "eng">("pm");

  const pmQuestions = prd.open_questions.filter((q) => q.audience === "pm");
  const engQuestions = prd.open_questions.filter((q) => q.audience === "engineering");

  return (
    <div className="mt-6 rounded-[10px] border border-mist bg-bone-2 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-[10px]">
        <Eyebrow>Product requirements</Eyebrow>
        <Tabs
          aria-label="PRD rendition"
          value={view}
          onChange={(v) => setView(v as "pm" | "eng")}
          tabs={[
            { value: "pm", label: "PM view" },
            { value: "eng", label: "Engineering view" },
          ]}
        />
      </div>

      {prd.scouted_repos.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-[6px]">
          {prd.scouted_repos.map((r) => (
            <span
              key={r}
              className="inline-flex items-center gap-[5px] rounded-[6px] bg-paper-2 px-[8px] py-[3px] font-mono text-[10.5px] text-ink-2"
              title="Repo scouted for evidence while writing this PRD"
            >
              <GitBranch size={10} strokeWidth={1.8} className="text-slate" />
              {r}
            </span>
          ))}
        </div>
      )}

      <SummaryMarkdown source={view === "pm" ? prd.pm_doc : prd.eng_doc} />

      {prd.open_questions.length > 0 && (
        <div className="mt-6 border-t border-mist pt-4">
          <div className="mb-[10px] flex items-center gap-[6px]">
            <HelpCircle size={13} strokeWidth={1.7} className="text-amber" />
            <Eyebrow>Open questions · {prd.open_questions.length}</Eyebrow>
          </div>
          <div className="flex flex-col gap-[14px]">
            {pmQuestions.length > 0 && (
              <QuestionGroup label="For the PM / client" questions={pmQuestions} />
            )}
            {engQuestions.length > 0 && (
              <QuestionGroup label="For engineering" questions={engQuestions} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionGroup({
  label,
  questions,
}: {
  label: string;
  questions: PrdArtifact["open_questions"];
}) {
  return (
    <div>
      <p className="m-0 mb-[6px] font-mono text-[10.5px] uppercase tracking-[0.07em] text-slate-2">
        {label}
      </p>
      <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
        {questions.map((q, i) => (
          <li key={i} className="rounded-[8px] border border-mist bg-paper-2 px-[12px] py-[9px]">
            <p className="m-0 text-[13px] leading-snug text-ink">{q.question}</p>
            <p className="m-0 mt-[3px] text-[11.5px] leading-snug text-slate">
              {q.why_it_matters}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
