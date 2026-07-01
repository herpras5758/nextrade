import pg from "pg";
export declare function getPool(): Promise<pg.Pool>;
/**
 * Runs `fn` with a dedicated client that has app.current_tenant_id set
 * for the duration of the transaction. Rule #7: this is the only path
 * into the database — there is no "raw pool.query" used in route
 * handlers, specifically so a tenant-scoping mistake can't compile.
 */
export declare function withTenant<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
