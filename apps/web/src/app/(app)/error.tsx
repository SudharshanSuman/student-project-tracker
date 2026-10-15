"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      title="This page failed to load"
      description="The server could not complete the request. Try again; if it keeps failing, contact an admin."
      action={<Button variant="outline" onClick={reset}>Try again</Button>}
    />
  );
}
