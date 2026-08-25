// Workspace-shaped skeleton so opening a meeting paints instantly while the
// dynamic page renders on the server.
export default function Loading() {
  return (
    <div className="flex h-screen flex-col overflow-hidden" aria-busy="true">
      <header className="flex items-center justify-between gap-[14px] px-[22px] py-[14px] pt-[calc(14px+var(--titlebar-inset,0px))] border-b border-mist bg-bone-2">
        <div className="flex items-center gap-[14px] animate-pulse">
          <div className="h-[12px] w-[70px] rounded-[4px] bg-mist" />
          <div className="h-[16px] w-[220px] rounded-[4px] bg-mist" />
        </div>
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-[26px] w-[90px] rounded-[6px] bg-mist" />
          <div className="h-[26px] w-[70px] rounded-[6px] bg-mist" />
        </div>
      </header>
      <div className="flex-1 min-h-0 px-[22px] py-[18px]">
        <div className="mx-auto w-full max-w-[880px] flex flex-col gap-[10px] animate-pulse">
          <div className="h-[52px] rounded-[10px] bg-bone-2" />
          <div className="h-[52px] rounded-[10px] bg-bone-2" />
          <div className="h-[52px] rounded-[10px] bg-bone-2" />
        </div>
      </div>
    </div>
  );
}
