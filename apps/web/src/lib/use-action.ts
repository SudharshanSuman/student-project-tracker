"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api-client";

/** Runs a mutation, toasts the outcome and re-renders server data. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setPending(true);
      try {
        const result = await fn();
        if (success) toast.success(success);
        router.refresh();
        return result;
      } catch (err) {
        toast.error(errorMessage(err));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [router],
  );
  return { run, pending };
}
