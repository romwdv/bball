/**
 * Grille de cartes de statistiques (PLAN.md §12).
 *
 * La maquette aligne les cartes en lignes de largeurs différentes :
 *
 * ```
 * Points | % Tirs                      ← 2 cartes
 * %2PTS  | %3PTS | %LF                 ← 3 cartes
 * PD | INT | BP | CTR                  ← 4 cartes
 * RB | RD | RO                         ← 3 cartes
 * ```
 *
 * Chaque ligne a sa propre grille : une carte par cellule, toutes égales. C'est
 * la seule façon de tenir l'ordonnancement exact de la maquette — un simple
 * `grid-cols-3` avec des cartes qui span porrait laisser des trous.
 */

export interface StatCardData {
  label: string;
  value: string;
}

const GRID_COLUMNS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function StatCards({
  rows,
}: {
  rows: readonly (readonly StatCardData[])[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, index) => (
        <div
          key={index}
          className={`grid gap-1.5 ${GRID_COLUMNS[row.length] ?? "grid-cols-3"}`}
        >
          {row.map((card) => (
            <div
              key={card.label}
              className="flex flex-col items-center justify-center gap-0.5 rounded-[10px] border border-white bg-raised py-3"
            >
              <span className="text-sm text-muted">{card.label}</span>
              <span className="tabular text-2xl text-primary">{card.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}