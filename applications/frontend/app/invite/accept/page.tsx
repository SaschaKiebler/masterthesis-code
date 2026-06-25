/**
 * Invite Accept Page
 * Handles the invitation acceptance flow:
 * 1. Fetches invitation details by token (public)
 * 2. If not authenticated → prompts login with returnTo
 * 3. If authenticated → shows invitation details + accept button
 * 4. On accept → calls API → redirects to dashboard
 *
 * Server component wrapper with Suspense boundary (guidelines: server by default).
 * Client content split into InviteAcceptContent.
 */

import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import InviteAcceptContent from "./InviteAcceptContent";

/** Skeleton shown inside Suspense while useSearchParams resolves */
function InviteAcceptSkeleton() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card variant="bordered" padding="lg">
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center gap-3">
              <Skeleton variant="circle" className="h-14 w-14" />
              <Skeleton variant="text" className="h-7 w-48" />
              <Skeleton variant="text" className="h-4 w-64" />
            </div>
            <div className="rounded-lg bg-muted/50 p-4 space-y-3">
              <Skeleton variant="text" className="h-5 w-full" />
              <Skeleton variant="text" className="h-5 w-3/4" />
              <Skeleton variant="text" className="h-5 w-1/2" />
            </div>
            <Skeleton variant="custom" className="h-12 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense fallback={<InviteAcceptSkeleton />}>
      <InviteAcceptContent />
    </Suspense>
  );
}
