// Skeleton shown by route loading.tsx boundaries while a dynamic page's
// server render is in flight. Mirrors the standard app page shell
// (max-w-[880px] px-10 py-12 with a heading block) so the swap to real
// content doesn't shift layout.
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12" aria-busy="true">
      <div className="mb-9 animate-pulse">
        <div className="h-[28px] w-[180px] rounded-[6px] bg-bone-2" />
        <div className="mt-[10px] h-[14px] w-[300px] rounded-[4px] bg-bone-2" />
      </div>
      <div className="flex flex-col gap-[10px] animate-pulse">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-[52px] rounded-[10px] bg-bone-2" />
        ))}
      </div>
    </div>
  );
}
