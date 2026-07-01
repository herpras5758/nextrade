import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "../lib/AuthContext";
import { apiClient } from "../lib/apiClient";

// Rule #7 (non-negotiable): every query, every UI, every piece of data
// is scoped to the active tenant. This context is the single source of
// truth for "which Business Unit is the user currently looking at."
//
// Tenant IDs come from the verified JWT claim (custom:tenant_ids) —
// never client-supplied or guessable — then this provider fetches each
// tenant's display name via GET /tenants/:id (the JWT only carries
// UUIDs). A user can never end up with a tenant in this list they
// weren't actually granted, because the claim itself is what drives the
// fetch.

export interface Tenant {
  id: string;
  name: string;
  code: string;
  groupName: string;
  language: "id" | "en";
}

interface TenantContextValue {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  isLoading: boolean;
  switchTenant: (tenantId: string) => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { claims, isAuthenticated } = useAuth();
  const [availableTenants, setAvailableTenants] = useState<Tenant[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || !claims) {
      setIsLoading(false);
      return;
    }
    const tenantIds = (claims["custom:tenant_ids"] ?? "").split(",").filter(Boolean);
    if (tenantIds.length === 0) {
      setIsLoading(false);
      return;
    }

    Promise.all(
      tenantIds.map((id) =>
        apiClient.get(`/tenants/${id}`).then((res) => ({
          id: res.data.id,
          name: res.data.name,
          code: res.data.code,
          groupName: res.data.group_name,
          language: res.data.default_language,
        }))
      )
    )
      .then((tenants) => {
        setAvailableTenants(tenants);
        setCurrentTenantId(tenants[0]?.id ?? null);
      })
      .catch((err) => {
        console.error("[TenantProvider] tenant fetch failed:", err);
      })
      .finally(() => setIsLoading(false));
  }, [isAuthenticated, claims]);

  const value: TenantContextValue = {
    currentTenant: availableTenants.find((t) => t.id === currentTenantId) ?? null,
    availableTenants,
    isLoading,
    switchTenant: (tenantId: string) => {
      const exists = availableTenants.some((t) => t.id === tenantId);
      if (!exists) {
        console.error(`Tenant ${tenantId} is not accessible to this user.`);
        return;
      }
      setCurrentTenantId(tenantId);
    },
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}
