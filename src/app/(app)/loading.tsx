import { PageSkeleton } from "@/components/ui/PageSkeleton";

// Suspense boundary for all (app) routes. Its presence also re-enables Link
// prefetching for these force-dynamic pages (Next only prefetches dynamic
// routes down to a loading boundary), so sidebar clicks paint immediately.
export default function Loading() {
  return <PageSkeleton />;
}
