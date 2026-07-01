import { Navigate } from "react-router-dom";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { ENV } from "./env";
import { setAuthTokenGetter } from "./apiClient";

const userPool = new CognitoUserPool({
  UserPoolId: ENV.cognitoUserPoolId,
  ClientId: ENV.cognitoClientId,
});

export interface DecodedTokenClaims {
  sub: string;
  email: string;
  given_name?: string;
  family_name?: string;
  "cognito:groups"?: string[];
  "custom:tenant_ids"?: string;
  "custom:preferred_lang"?: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  claims: DecodedTokenClaims | null;
  idToken: string | null;
  login: (email: string, password: string) => Promise<{ requiresNewPassword: boolean }>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function decodeJwt(token: string): DecodedTokenClaims {
  const payload = token.split(".")[1];
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [claims, setClaims] = useState<DecodedTokenClaims | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingCognitoUser, setPendingCognitoUser] = useState<CognitoUser | null>(null);

  useEffect(() => { setAuthTokenGetter(() => idToken); }, [idToken]);

  useEffect(() => {
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      setIsLoading(false);
      return;
    }
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        setIsLoading(false);
        return;
      }
      const token = session.getIdToken().getJwtToken();
      setIdToken(token);
      setClaims(decodeJwt(token));
      setIsLoading(false);
    });
  }, []);

  function login(email: string, password: string): Promise<{ requiresNewPassword: boolean }> {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      const authDetails = new AuthenticationDetails({ Username: email, Password: password });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          const token = session.getIdToken().getJwtToken();
          setIdToken(token);
          setClaims(decodeJwt(token));
          resolve({ requiresNewPassword: false });
        },
        onFailure: (err) => reject(err),
        newPasswordRequired: () => {
          setPendingCognitoUser(cognitoUser);
          resolve({ requiresNewPassword: true });
        },
      });
    });
  }

  function completeNewPassword(newPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!pendingCognitoUser) return reject(new Error("No pending login to complete"));
      pendingCognitoUser.completeNewPasswordChallenge(
        newPassword,
        {},
        {
          onSuccess: (session) => {
            const token = session.getIdToken().getJwtToken();
            setIdToken(token);
            setClaims(decodeJwt(token));
            setPendingCognitoUser(null);
            resolve();
          },
          onFailure: (err) => reject(err),
        }
      );
    });
  }

  function logout() {
    const currentUser = userPool.getCurrentUser();
    currentUser?.signOut();
    setIdToken(null);
    setClaims(null);
  }

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: !!idToken, isLoading, claims, idToken, login, completeNewPassword, logout }}
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

// AuthGuard — wraps routes that require authentication.
// Redirects to /login if no active session.

export function AuthGuard({ children }: { children: ReactNode }) {
  const { claims, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-surface-muted text-sm">
        Memuat...
      </div>
    );
  }
  if (!claims) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
