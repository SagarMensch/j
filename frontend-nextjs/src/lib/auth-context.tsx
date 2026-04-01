"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

export type UserRole = "operator" | "admin";
export type AppLanguage = "ENG" | "HIN" | "HING";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  login: (role: UserRole) => void;
  logout: () => void;
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}

const defaultUsers: Record<UserRole, User> = {
  operator: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Aarav Sharma",
    email: "aarav.s@jubilant.com",
    role: "operator",
    department: "Production",
  },
  admin: {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Admin User",
    email: "admin@jubilant.com",
    role: "admin",
    department: "Quality",
  },
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [language, setLanguageState] = useState<AppLanguage>("ENG");

  useEffect(() => {
    // Restore user from localStorage if available
    const savedRole = localStorage.getItem("user_role") as UserRole | null;
    const savedLanguage = localStorage.getItem("language");

    if (savedRole && defaultUsers[savedRole]) {
      setUser(defaultUsers[savedRole]);
    }

    if (
      savedLanguage === "ENG" ||
      savedLanguage === "HIN" ||
      savedLanguage === "HING"
    ) {
      setLanguageState(savedLanguage);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("language", language);

    // Keep UI density and copy mode in sync with selected language.
    document.documentElement.setAttribute("data-language", language);
    document.documentElement.style.setProperty(
      "--locale-scale",
      language === "ENG" ? "1" : "1.03",
    );
  }, [language]);

  const setLanguage = (lang: AppLanguage) => {
    setLanguageState(lang);
  };

  const login = (role: UserRole) => {
    const user = defaultUsers[role];
    setUser(user);

    // Persist to localStorage
    localStorage.setItem("user_role", role);
    localStorage.setItem("user_id", user.id);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("user_role");
    localStorage.removeItem("user_id");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        login,
        logout,
        language,
        setLanguage,
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
