import type { VerisphereAPI } from "./contract";
import { mockApi } from "./mock";
import { httpApi } from "./http";
import { env } from "../shared/env";

/**
 * Adapter selection for claim/staking DATA (not validation).
 *
 *   VITE_API_MODE=http  → real app backend (reads live; writes still delegate
 *                          to the mock until the wallet + relay land)
 *   VITE_API_MODE=mock  → fully self-contained demo (default)
 *
 * Validation checks are NOT part of this adapter — see `api/checks.ts`
 * (moderation, dedup and atomicity via the app) and `shared/claimChecks.ts`
 * (local).
 */
export const api: VerisphereAPI = env.apiMode === "http" ? httpApi : mockApi;

export type { VerisphereAPI };
