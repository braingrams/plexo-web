export interface FakeUser {
  id: string;
  email: string;
  name: string;
  image?: string;
  passwordHash?: string;
  isConfirmed?: boolean;
  suspendedAt?: string;
  charisolSub?: string;
  charisolPasswordAt?: string;
}

/** In-memory stand-in for the ElectroDB `User` entity — only the calls the auth code makes. */
export function createFakeUserEntity(store: Map<string, FakeUser>) {
  return {
    get: ({ id }: { id: string }) => ({ go: async () => ({ data: store.get(id) ?? null }) }),
    query: {
      byEmail: ({ email }: { email: string }) => ({
        go: async () => ({ data: [...store.values()].filter((u) => u.email === email) }),
      }),
    },
    patch: ({ id }: { id: string }) => ({
      set: (changes: Partial<FakeUser>) => ({
        go: async () => {
          const u = store.get(id);
          if (!u) throw new Error("patch on missing user");
          Object.assign(u, changes);
          return { data: u };
        },
      }),
    }),
    create: (user: FakeUser) => ({
      go: async () => {
        store.set(user.id, { ...user });
        return { data: user };
      },
    }),
  };
}

/** In-memory stand-in for lib/db/coreOperations' email-locked user creation. */
export function createFakeCoreOperations(store: Map<string, FakeUser>) {
  class EmailAlreadyInUseError extends Error {
    constructor(email: string) {
      super(`Email already in use: ${email}`);
      this.name = "EmailAlreadyInUseError";
    }
  }
  return {
    EmailAlreadyInUseError,
    createUserWithEmailLock: async (user: FakeUser) => {
      if ([...store.values()].some((u) => u.email === user.email)) throw new EmailAlreadyInUseError(user.email);
      store.set(user.id, { ...user });
    },
  };
}
