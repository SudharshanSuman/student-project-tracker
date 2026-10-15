"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message === "forbidden";
  return (
    <EmptyState
      title={forbidden ? "Access restricted" : "This page failed to load"}
      description={forbidden ? "Your role does not have access to this data." : "The server could not complete the request. Try again; if it keeps failing, contact an admin."}
      action={forbidden ? undefined : <Button variant="outline" onClick={reset}>Try again</Button>}
    />
  );
}
