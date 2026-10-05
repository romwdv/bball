export default function Page() {
  return (
    <main className="flex flex-1 flex-col gap-2 p-6 pt-(--padding-safe-t)">
      <h1 className="text-xl font-semibold">/stats/</h1>
      <p className="text-sm text-secondary">
        Statistiques cumulees de tous les matchs, avec moyennes.
      </p>
    </main>
  );
}
