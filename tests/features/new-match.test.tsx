import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDb, setRepos } from "@/data";
import {
  createRepositories,
  SON,
  type Repositories,
} from "@/data/repositories";
import { SpaceBunnyDB } from "@/data/schema";

/**
 * Écran « Nouveau match », sans roster (PLAN.md §11).
 *
 * L'écran a perdu toute la gestion de roster : plus de cases à cocher, plus de
 * formulaire d'ajout, plus de tri. Ce qu'il reste — un joueur, deux champs, un
 * bouton — est testable, et c'est ce qui compte : ces tests verrouillent que la
 * suppression est **complète**, pas seulement que le nouvel écran marche.
 *
 * Le routeur est simulé : `useRouter` de `next/navigation` lève hors d'un
 * arbre Next, et `output: 'export'` interdit tout serveur.
 */

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}));

const NewMatchPage = (await import("@/app/new-match/page"))
  .default as () => React.JSX.Element;

let counter = 0;
let database: SpaceBunnyDB;
let repos: Repositories;

beforeEach(async () => {
  counter += 1;
  push.mockClear();
  database = new SpaceBunnyDB(`space-bunny-newmatch-${counter}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

async function renderPage() {
  render(<NewMatchPage />);
  // Le joueur est créé en asynchrone (`ensureSon` dans l'effet) et l'écran ne
  // l'affiche plus (PLAN.md §12) : la seule façon d'attendre la fin de l'effet
  // est d'observer la base. La plupart des tests partent de zéro joueur et
  // doivent en voir exactement un.
  await waitFor(async () => {
    expect(await repos.players.listByTeam("local")).toHaveLength(1);
  });
}

describe("écran nouveau match — joueur unique", () => {
  it("crée le joueur suivi", async () => {
    await renderPage();

    // L'identité vient du code, pas d'une saisie. L'écran ne l'affiche plus,
    // mais le joueur doit exister en base pour que la création du match puisse
    // le référencer.
    const roster = await repos.players.listByTeam("local");
    expect(roster).toHaveLength(1);
    expect(roster[0]!.firstName).toBe(SON.firstName);
  });

  it("n'affiche aucun contrôle de roster", async () => {
    await renderPage();

    // La régression à verrouiller : un « Ajouter un joueur » qui survivrait
    // laisserait le coach créer un second joueur, dont les actions seraient
    // ensuite comptées dans les stats cumulées à côté du fils.
    expect(screen.queryByText(/Roster/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ajouter/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cocher/i }),
    ).not.toBeInTheDocument();
  });

  it("n'affiche pas de champ de nom de joueur", async () => {
    await renderPage();

    expect(screen.queryByLabelText(/Nom du joueur/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Numéro/i)).not.toBeInTheDocument();
  });

  it("crée le match avec le joueur suivi", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.type(screen.getByPlaceholderText("BC Nuit"), "BC Est");
    await user.click(screen.getByRole("button", { name: /Commencer/ }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        expect.stringMatching(/^\/match\/\?m=/),
      );
    });

    const matches = await repos.matches.listByTeam("local");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.playerIds).toEqual([
      (await repos.players.listByTeam("local"))[0]!.id,
    ]);
  });

  it("refuse de créer un match sans adversaire", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: /Commencer/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/adversaire/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("adopte un joueur déjà présent sans en créer un second", async () => {
    // Cas de la mise à jour d'une base existante : le joueur créé par une
    // version précédente doit être repris, sinon la saisie repartirait sur une
    // ligne neuve et les actions déjà saisies seraient orphelines.
    const existing = await repos.players.create("local", {
      firstName: SON.firstName,
      lastName: "",
    });

    await renderPage();

    expect(await repos.players.listByTeam("local")).toHaveLength(1);
    expect((await repos.players.listByTeam("local"))[0]!.id).toBe(existing.id);
  });

  it("écarte les joueurs parasites d'une base de test", async () => {
    await repos.players.createMany("local", [
      { firstName: "Ada", lastName: "Lovelace" },
      { firstName: "Zoe", lastName: "Zzz" },
    ]);

    await renderPage();

    const roster = await repos.players.listByTeam("local");
    expect(roster).toHaveLength(1);
    expect(roster[0]!.firstName).toBe(SON.firstName);
  });
});
