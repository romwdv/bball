import Link from "next/link";

const ROUTES = [
  { href: "/", label: "Matchs", phase: "Phase 3" },
  { href: "/match/", label: "Saisie", phase: "Phase 3" },
  { href: "/history/", label: "Historique", phase: "Phase 5" },
  { href: "/stats/", label: "Stats cumulées", phase: "Phase 5" },
] as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-6 pt-(--padding-safe-t)">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Socle installé</h1>
        <p className="text-sm text-secondary">
          Build statique, theme dark, routes preparees.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {ROUTES.map((route) => (
          <li key={route.href}>
            <Link
              href={route.href}
              className="surface-card flex min-h-tap-min items-center justify-between px-4 py-3"
            >
              <span className="font-medium">{route.label}</span>
              <span className="tabular text-xs text-muted">{route.phase}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-auto text-xs text-muted">
        Les 4 routes fixes correspondent aux 4 écrans prevus. L&apos;identifiant
        du match passera en query param : <code>/match/?m=…</code>
      </p>
    </main>
  );
}
