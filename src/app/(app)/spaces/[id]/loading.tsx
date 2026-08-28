// Space-workspace-shaped skeleton (two-column: meetings list + chat panel)
// so opening a space paints instantly while the dynamic page renders.
export default function Loading() {
  return (
    <div className="flex h-screen flex-col overflow-hidden" aria-busy="true">
      <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1.25fr_1fr]">
        <section className="min-h-0 overflow-hidden border-b border-mist lg:border-b-0 lg:border-r">
          <div className="mx-auto w-full max-w-[880px] px-10 py-12 animate-pulse">
            <div className="h-[12px] w-[64px] rounded-[4px] bg-bone-2 mb-[18px]" />
            <div className="h-[28px] w-[220px] rounded-[6px] bg-bone-2" />
            <div className="mt-9 mb-[10px] h-[12px] w-[110px] rounded-[4px] bg-bone-2" />
            <div className="flex flex-col gap-[10px]">
              <div className="h-[52px] rounded-[10px] bg-bone-2" />
              <div className="h-[52px] rounded-[10px] bg-bone-2" />
              <div className="h-[52px] rounded-[10px] bg-bone-2" />
            </div>
          </div>
        </section>
        <section className="hidden lg:block min-h-0 bg-bone-2/40" />
      </div>
    </div>
  );
}
