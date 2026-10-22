import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";

interface AuthUser {
  id: number;
  username: string;
  name: string | null;
  role: string;
  twoFactorEnabled: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ requiresTwoFactor: true; ticket: string } | { requiresTwoFactor: false }>;
  verifyTwoFactorLogin: (ticket: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (!data.requiresTwoFactor) {
        setUser(data.user);
        utils.auth.me.invalidate();
      }
    },
  });

  const verifyTwoFactorLoginMutation = trpc.auth.verifyTwoFactorLogin.useMutation({
    onSuccess: (data) => {
      setUser(data.user);
      utils.auth.me.invalidate();
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      setUser(null);
      utils.invalidate();
    },
  });

  useEffect(() => {
    if (meQuery.data) {
      setUser(meQuery.data);
    } else if (meQuery.isError) {
      setUser(null);
    }
  }, [meQuery.data, meQuery.isError]);

  const login = async (username: string, password: string) => {
    const result = await loginMutation.mutateAsync({ username, password });
    if (result.requiresTwoFactor) {
      return { requiresTwoFactor: true as const, ticket: result.ticket };
    }
    return { requiresTwoFactor: false as const };
  };

  const verifyTwoFactorLogin = async (ticket: string, code: string) => {
    await verifyTwoFactorLoginMutation.mutateAsync({ ticket, code });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: meQuery.isLoading,
        login,
        verifyTwoFactorLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
