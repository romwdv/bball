export default function Page() {
  return (
    <main className="flex flex-1 flex-col gap-2 p-6 pt-(--padding-safe-t)">
      <h1 className="text-xl font-semibold">/match/</h1>
      <p className="text-sm text-secondary">
        Ecran de saisie en temps reel. Le match est lu dans le query param `m`.
      </p>
    </main>
  );
}
