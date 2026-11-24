// SERVER-ONLY. The catalogue as learners see it: the built-in list with database-published missions overlaid
// (ADR-015). If the database is unreachable the built-in list is returned unchanged.
import { getCatalogue, overlayCatalogue, type CatalogueTrack } from "../lib/catalogue";
import { publishedSummaries } from "./content-db";

export async function getLiveCatalogue(): Promise<CatalogueTrack[]> {
  const [base, published] = await Promise.all([getCatalogue(), publishedSummaries()]);
  return overlayCatalogue(base, published);
}
