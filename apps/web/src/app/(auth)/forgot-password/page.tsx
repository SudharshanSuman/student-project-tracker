"use client";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@iic/shared";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(forgotPasswordSchema) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reset password</CardTitle>
        <CardDescription>We will email a reset link valid for one hour.</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-sm text-muted-foreground">If an active account exists for that email, a reset link is on its way.</p>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={handleSubmit(async (v) => {
              setError(null);
              try {
                await api("/auth/password/forgot", { body: v });
                setSent(true);
              } catch (e) {
                setError(errorMessage(e));
              }
            })}
          >
            <Field label="Email" htmlFor="email" error={formState.errors.email?.message ?? error ?? undefined}>
              <Input id="email" type="email" autoComplete="email" {...register("email")} />
            </Field>
            <Button className="w-full" disabled={formState.isSubmitting}>Send reset link</Button>
          </form>
        )}
        <p className="mt-4 text-center text-xs">
          <Link href="/login" className="text-muted-foreground hover:text-foreground">Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
