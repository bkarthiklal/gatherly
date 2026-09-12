import type {
  AuthResponse,
  LoginInput,
  PublicUser,
  RegisterInput,
  UserRole,
} from '@gatherly/types';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { api, onSessionChange, refreshSession, setSession } from './api';

interface AuthState {
  user: PublicUser | null;
  /** True until the initial session restore has finished. */
  loading: boolean;
  login: (input: LoginInput) => Promise<PublicUser>;
  register: (input: RegisterInput) => Promise<PublicUser>;
  logout: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = onSessionChange((session) => setUser(session?.user ?? null));
    // A page load has no access token; the httpOnly cookie may still hold a session.
    void refreshSession().finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: async (input) => {
      const session = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: input,
        noRetry: true,
      });
      setSession(session);
      return session.user;
    },
    register: async (input) => {
      const session = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: input,
        noRetry: true,
      });
      setSession(session);
      return session.user;
    },
    logout: async () => {
      await api('/auth/logout', { method: 'POST', noRetry: true }).catch(() => undefined);
      setSession(null);
      queryClient.clear();
    },
    hasRole: (...roles) => (user ? roles.includes(user.role) : false),
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
