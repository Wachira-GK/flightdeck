// SERVER-ONLY. The verified id of the signed-in learner for the current request, or null.
// Kept apart from progress.ts so that module stays free of next/headers and easy to unit-test.
import { readSession } from "./auth/session";

/** Signed out, expired session, or auth not configured all return null: callers then simply do not save. */
export async function currentUserId(): Promise<string | null> {
  try {
    const s = await readSession();
    return s.status === "signed-in" ? s.user.id : null;
  } catch {
    return null;
  }
}
