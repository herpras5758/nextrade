import pg from "pg";
export type UnifiedShipmentStatus = "DOCUMENT_MISMATCH" | "NEEDS_REVIEW" | "READY_FOR_CEISA" | "DRAFT";
export interface ShipmentStatusResult {
    status: UnifiedShipmentStatus;
    readinessScore: number;
    openValidationErrorCount: number;
    fieldsNeedingReviewCount: number;
    documentsStillProcessingCount: number;
}
export declare function computeUnifiedShipmentStatus(client: pg.PoolClient, shipmentId: string, tenantId: string): Promise<ShipmentStatusResult>;
