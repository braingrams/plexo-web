// React helpers for the Plexo client: who's signed in, and gating pages behind sign-in.
//
//   const { user, loading } = useAuth();
//   <RequireAuth><Dashboard /></RequireAuth>
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { plexo, type PlexoUser } from "@/lib/plexo";

type AuthState = { user: PlexoUser | null; loading: boolean; refresh: () => Promise<void> };

const AuthContext = createContext<AuthState>({ user: null, loading: true, refresh: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlexoUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const { data } = await plexo.auth.getUser();
    setUser(data.user);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const { unsubscribe } = plexo.auth.onAuthStateChange((_event, next) => setUser(next));
    return () => {
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user, loading, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Shows children only to signed-in visitors; everyone else goes to `redirectTo` (default
 * /login), and comes back here after signing in. Pass `role` to require a role too. */
export function RequireAuth({ children, redirectTo = "/login", role }: { children: ReactNode; redirectTo?: string; role?: string }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to={`${redirectTo}?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
