import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";


import { useRef } from "react";
import { fetchWithNetworkRetry } from "@/lib/browser-retry";

export type MumoUser = {
  id: string;
  email: string | null;
};

export type MumoSession = {
  user: MumoUser;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  credits: number;
};

export type AuthProbeError = "network" | "timeout";
export type AuthStatus = "loading" | "anonymous" | "authenticated" | "unavailable";

type AuthMeResponse = {
  user?: MumoUser | null;
  profile?: Profile | null;
};

type AuthCtx = {
  session: MumoSession | null;
  user: MumoUser | null;
  profile: Profile | null;
  loading: boolean;
  authStatus: AuthStatus;
  authProbeError: AuthProbeError | null;
  refreshProfile: () => Promise<boolean>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function getAuthProbeError(error: unknown): AuthProbeError {
  return error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network";
}

async function fetchCurrentUser(): Promise<AuthMeResponse> {
  const res = await fetchWithNetworkRetry("/api/auth/me", {
    method: "GET",
    credentials: "include",
    headers: { "accept": "application/json" },
  });

  if (!res.ok) {
    return { user: null, profile: null };
  }

  return res.json() as Promise<AuthMeResponse>;
}

function normalizeProfile(profile: Profile | null | undefined): Profile | null {
  if (!profile) return null;

  return {
    ...profile,
    credits: Number(profile.credits ?? 0),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MumoSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authProbeError, setAuthProbeError] = useState<AuthProbeError | null>(null);
  const profileRequestIdRef = useRef(0);

  const refreshProfile = useCallback(async () => {
    const requestId = ++profileRequestIdRef.current;
    try {
      const data = await fetchCurrentUser();
      if (requestId !== profileRequestIdRef.current) return false;
      const user = data.user ?? null;

      setSession(user ? { user } : null);
      setProfile(normalizeProfile(data.profile));
      setAuthStatus(user ? "authenticated" : "anonymous");
      setAuthProbeError(null);
      return true;
    } catch (error) {
      if (requestId !== profileRequestIdRef.current) return false;
      // A profile probe failure is not an authentication failure. Preserve the
      // current session state and keep this diagnostic out of AuthModal.
      setAuthStatus("unavailable");
      setAuthProbeError(getAuthProbeError(error));
      return false;
    }
  }, []);

  useEffect(() => {
    let alive = true;

    fetchCurrentUser()
      .then((data) => {
        if (!alive) return;

        const user = data.user ?? null;
        setSession(user ? { user } : null);
        setProfile(normalizeProfile(data.profile));
        setAuthStatus(user ? "authenticated" : "anonymous");
        setAuthProbeError(null);
      })
      .catch((error) => {
        if (!alive) return;

        setSession(null);
        setProfile(null);
        setAuthStatus("unavailable");
        setAuthProbeError(getAuthProbeError(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setSession(null);
      setProfile(null);
      setAuthStatus("anonymous");
      setAuthProbeError(null);
    }
  }, []);

  return (
    <Ctx.Provider value={{ session, user: session?.user ?? null, profile, loading, authStatus, authProbeError, refreshProfile, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

const FALLBACK: AuthCtx = {
  session: null,
  user: null,
  profile: null,
  loading: true,
  authStatus: "loading",
  authProbeError: null,
  refreshProfile: async () => false,
  signOut: async () => {},
};

export function useAuth() {
  const v = useContext(Ctx);
  return v ?? FALLBACK;
}
