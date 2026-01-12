import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

interface User {
  id: string;
  name: string;
  mobileNumber: string;
  accessType: string;
  coldStorageId: string;
}

interface ColdStorage {
  id: string;
  name: string;
  address?: string;
  tehsil?: string;
  district?: string;
  state?: string;
  pincode?: string;
  totalCapacity: number;
  waferRate: number;
  seedRate: number;
}

interface AuthContextType {
  user: User | null;
  coldStorage: ColdStorage | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (user: User, coldStorage: ColdStorage, token: string) => void;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_TOKEN_KEY = "cold_store_auth_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [coldStorage, setColdStorage] = useState<ColdStorage | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return false;
    }

    try {
      const response = await fetch("/api/auth/session", {
        headers: {
          "x-auth-token": storedToken,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        setColdStorage(data.coldStorage);
        setToken(storedToken);
        setIsLoading(false);
        return true;
      } else {
        // Token invalid, clear it
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setUser(null);
        setColdStorage(null);
        setToken(null);
        setIsLoading(false);
        return false;
      }
    } catch (error) {
      console.error("Failed to refresh session:", error);
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
      setColdStorage(null);
      setToken(null);
      setIsLoading(false);
      return false;
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = (user: User, coldStorage: ColdStorage, token: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setUser(user);
    setColdStorage(coldStorage);
    setToken(token);
  };

  const logout = async () => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedToken) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "x-auth-token": storedToken,
          },
        });
      } catch (error) {
        console.error("Logout error:", error);
      }
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
    setColdStorage(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        coldStorage,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        login,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
