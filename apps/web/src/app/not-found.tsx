import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="tabular-nums text-sm text-muted-foreground">404</p>
        <h1 className="mt-1 text-lg font-semibold">Not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It does not exist, or you do not have access to it.</p>
        <Link className="mt-4 inline-block text-sm text-link" href="/dashboard">Back to dashboard</Link>
      </div>
    </main>
  );
}
