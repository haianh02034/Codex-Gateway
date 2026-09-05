import { StoredUser } from '../auth.types';

/**
 * Where gateway users come from.
 *
 * Phase 0 ships {@link EnvUserStore}: a single administrator seeded from the
 * environment, which is enough to exercise the guards. Phase 3 replaces the
 * binding with a Mongo-backed store — that is also where per-user ownership
 * of projects and conversations begins, so no other layer needs to change.
 */
export interface UserStore {
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<StoredUser | null>;
}

export const USER_STORE = Symbol('USER_STORE');
