export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary font-mono text-xs font-bold">IIC</span>
          <span className="font-semibold">Innovation Incubation Cell</span>
        </div>
        {children}
      </div>
    </main>
  );
}
