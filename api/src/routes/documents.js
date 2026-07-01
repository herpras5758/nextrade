"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentRoutes = documentRoutes;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const s3 = new client_s3_1.S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
});
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
async function documentRoutes(app) {
    // POST /tenants/:tenantId/documents/upload-url
    // Returns a presigned S3 PUT URL under the "uploads/" prefix AND
    // registers the documents row in the SAME call, in that order — the
    // document row exists in the DB BEFORE the client ever starts
    // uploading bytes. This eliminates the race condition where
    // trigger-pipeline (fired by the S3 EventBridge rule) could fire
    // before the documents row existed: with single-file upload that race
    // was rare; with bulk upload of hundreds of files in parallel, it
    // became common enough to be a real reliability problem.
    app.post("/tenants/:tenantId/documents/upload-url", async (request, reply) => {
        const { tenantId } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        const { fileName, contentType, shipmentId, uploadedBy, intakeSessionId } = request.body;
        const key = `uploads/${tenantId}/${crypto.randomUUID()}-${fileName}`;
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`INSERT INTO documents (tenant_id, shipment_id, file_name, s3_key, document_type, status, uploaded_by, intake_session_id, intake_source)
         VALUES ($1, $2, $3, $4, 'UNCLASSIFIED', 'pending_upload', $5, $6, $7)
         RETURNING id`, [
                tenantId,
                shipmentId ?? null,
                fileName,
                key,
                uploadedBy,
                intakeSessionId ?? null,
                intakeSessionId ? "bulk_upload" : "manual_upload",
            ]);
            const command = new client_s3_1.PutObjectCommand({
                Bucket: DOCUMENTS_BUCKET,
                Key: key,
                ContentType: contentType,
            });
            const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3, command, {
                expiresIn: 300,
                // Only sign the host header. If other headers (like content-type)
                // are signed into the URL, the browser adds its own sec-fetch-*,
                // accept, etc. headers that don't match the signature -> 403
                // SignatureDoesNotMatch. Keeping SignedHeaders=host only means
                // the browser can send whatever extra headers it wants without
                // breaking the signature.
                unhoistableHeaders: new Set(),
            });
            return { uploadUrl, s3Key: key, documentId: rows[0].id };
        });
    });
    // PATCH /tenants/:tenantId/documents/:id/confirm-upload
    // Client calls this after the S3 PUT succeeds, flipping status from
    // "pending_upload" to "uploaded". trigger-pipeline only starts a
    // pipeline execution for documents already past "pending_upload" —
    // belt-and-suspenders against the same race from the other direction
    // (an EventBridge event arriving before this confirm call would now
    // just see "pending_upload" and skip, instead of crashing).
    app.patch("/tenants/:tenantId/documents/:id/confirm-upload", async (request, reply) => {
        const { tenantId, id } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            await client.query(`UPDATE documents SET status = 'uploaded' WHERE id = $1 AND tenant_id = $2 AND status = 'pending_upload'`, [id, tenantId]);
            return { success: true };
        });
    });
    app.get("/tenants/:tenantId/documents", async (request, reply) => {
        const { tenantId } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`SELECT id, file_name, document_type, status, intake_source, uploaded_at
         FROM documents WHERE tenant_id = $1 ORDER BY uploaded_at DESC LIMIT 200`, [tenantId]);
            return rows;
        });
    });
    app.get("/tenants/:tenantId/documents/:id", async (request, reply) => {
        const { tenantId, id } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`SELECT id, shipment_id, file_name, document_type, status, intake_source, s3_key, uploaded_at
           FROM documents WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
            if (rows.length === 0)
                return reply.code(404).send({ error: "Document not found" });
            return rows[0];
        });
    });
    app.get("/tenants/:tenantId/documents/:id/download-url", async (request, reply) => {
        const { tenantId, id } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`SELECT s3_key FROM documents WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
            if (rows.length === 0)
                return reply.code(404).send({ error: "Document not found" });
            const { GetObjectCommand } = await Promise.resolve().then(() => require("@aws-sdk/client-s3"));
            const { getSignedUrl } = await Promise.resolve().then(() => require("@aws-sdk/s3-request-presigner"));
            const command = new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: rows[0].s3_key });
            const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
            return { downloadUrl };
        });
    });
    app.get("/tenants/:tenantId/documents/:id/extracted-fields", async (request, reply) => {
        const { tenantId, id } = request.params;
        (0, auth_js_1.assertTenantAccess)(request.auth, tenantId);
        return (0, pool_js_1.withTenant)(tenantId, async (client) => {
            const { rows } = await client.query(`SELECT fs.id, cf.field_key, fs.raw_value, fs.confidence, fs.reasoning,
                  cf.resolved_value, cf.status as field_status
           FROM ctdm_field_sources fs
           JOIN ctdm_fields cf ON cf.id = fs.ctdm_field_id
           WHERE fs.document_id = $1 AND cf.tenant_id = $2
           ORDER BY fs.confidence DESC`, [id, tenantId]);
            return rows;
        });
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG9jdW1lbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZG9jdW1lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBWUEsd0NBb0pDO0FBL0pELGtEQUFnRTtBQUNoRSx3RUFBNkQ7QUFDN0QsMkNBQTJDO0FBQzNDLG1EQUEyRDtBQUUzRCxNQUFNLEVBQUUsR0FBRyxJQUFJLG9CQUFRLENBQUM7SUFDdEIsMEJBQTBCLEVBQUUsZUFBZTtJQUMzQywwQkFBMEIsRUFBRSxlQUFlO0NBQzVDLENBQUMsQ0FBQztBQUNILE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBaUIsQ0FBQztBQUVoRCxLQUFLLFVBQVUsY0FBYyxDQUFDLEdBQW9CO0lBQ3ZELCtDQUErQztJQUMvQyxpRUFBaUU7SUFDakUsb0VBQW9FO0lBQ3BFLDhEQUE4RDtJQUM5RCw0REFBNEQ7SUFDNUQsaUVBQWlFO0lBQ2pFLHNFQUFzRTtJQUN0RSxrRUFBa0U7SUFDbEUseURBQXlEO0lBQ3pELEdBQUcsQ0FBQyxJQUFJLENBR0wseUNBQXlDLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUNyRSxNQUFNLEVBQUUsUUFBUSxFQUFFLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztRQUNwQyxJQUFBLDRCQUFrQixFQUFDLE9BQU8sQ0FBQyxJQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDNUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxlQUFlLEVBQUUsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDO1FBRXhGLE1BQU0sR0FBRyxHQUFHLFdBQVcsUUFBUSxJQUFJLE1BQU0sQ0FBQyxVQUFVLEVBQUUsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUVyRSxPQUFPLElBQUEsb0JBQVUsRUFBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQzNDLE1BQU0sRUFBRSxJQUFJ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QUFFLFlBQVksRUFBRSxHQUFHLDJDQUFhLCtCQUErQixFQUFDLENBQUM7WUFDdkUsTUFBTSxPQUFPLEdBQUcsSUFBSSxnQkFBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxnQkFBZ0IsRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDeEYsTUFBTSxXQUFXLEdBQUcsTUFBTSxZQUFZLENBQUMsRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1lBQ3pFLE9BQU8sRUFBRSxXQUFXLEVBQUUsQ0FBQztRQUN6QixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FDRixDQUFDO0lBRUYsR0FBRyxDQUFDLEdBQUcsQ0FDTCxtREFBbUQsRUFDbkQsS0FBSyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsRUFBRTtRQUN2QixNQUFNLEVBQUUsUUFBUSxFQUFFLEVBQUUsRUFBRSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUM7UUFDeEMsSUFBQSw0QkFBa0IsRUFBQyxPQUFPLENBQUMsSUFBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQzVDLE9BQU8sSUFBQSxvQkFBVSxFQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDM0MsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FDakM7Ozs7O3VDQUs2QixFQUM3QixDQUFDLEVBQUUsRUFBRSxRQUFRLENBQUMsQ0FDZixDQUFDO1lBQ0YsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FDRixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZhc3RpZnlJbnN0YW5jZSB9IGZyb20gXCJmYXN0aWZ5XCI7XG5pbXBvcnQgeyBTM0NsaWVudCwgUHV0T2JqZWN0Q29tbWFuZCB9IGZyb20gXCJAYXdzLXNkay9jbGllbnQtczNcIjtcbmltcG9ydCB7IGdldFNpZ25lZFVybCB9IGZyb20gXCJAYXdzLXNkay9zMy1yZXF1ZXN0LXByZXNpZ25lclwiO1xuaW1wb3J0IHsgd2l0aFRlbmFudCB9IGZyb20gXCIuLi9kYi9wb29sLmpzXCI7XG5pbXBvcnQgeyBhc3NlcnRUZW5hbnRBY2Nlc3MgfSBmcm9tIFwiLi4vbWlkZGxld2FyZS9hdXRoLmpzXCI7XG5cbmNvbnN0IHMzID0gbmV3IFMzQ2xpZW50KHtcbiAgcmVxdWVzdENoZWNrc3VtQ2FsY3VsYXRpb246IFwiV0hFTl9SRVFVSVJFRFwiLFxuICByZXNwb25zZUNoZWNrc3VtVmFsaWRhdGlvbjogXCJXSEVOX1JFUVVJUkVEXCIsXG59KTtcbmNvbnN0IERPQ1VNRU5UU19CVUNLRVQgPSBwcm9jZXNzLmVudi5ET0NVTUVOVFNfQlVDS0VUITtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRvY3VtZW50Um91dGVzKGFwcDogRmFzdGlmeUluc3RhbmNlKSB7XG4gIC8vIFBPU1QgL3RlbmFudHMvOnRlbmFudElkL2RvY3VtZW50cy91cGxvYWQtdXJsXG4gIC8vIFJldHVybnMgYSBwcmVzaWduZWQgUzMgUFVUIFVSTCB1bmRlciB0aGUgXCJ1cGxvYWRzL1wiIHByZWZpeCBBTkRcbiAgLy8gcmVnaXN0ZXJzIHRoZSBkb2N1bWVudHMgcm93IGluIHRoZSBTQU1FIGNhbGwsIGluIHRoYXQgb3JkZXIg4oCUIHRoZVxuICAvLyBkb2N1bWVudCByb3cgZXhpc3RzIGluIHRoZSBEQiBCRUZPUkUgdGhlIGNsaWVudCBldmVyIHN0YXJ0c1xuICAvLyB1cGxvYWRpbmcgYnl0ZXMuIFRoaXMgZWxpbWluYXRlcyB0aGUgcmFjZSBjb25kaXRpb24gd2hlcmVcbiAgLy8gdHJpZ2dlci1waXBlbGluZSAoZmlyZWQgYnkgdGhlIFMzIEV2ZW50QnJpZGdlIHJ1bGUpIGNvdWxkIGZpcmVcbiAgLy8gYmVmb3JlIHRoZSBkb2N1bWVudHMgcm93IGV4aXN0ZWQ6IHdpdGggc2luZ2xlLWZpbGUgdXBsb2FkIHRoYXQgcmFjZVxuICAvLyB3YXMgcmFyZTsgd2l0aCBidWxrIHVwbG9hZCBvZiBodW5kcmVkcyBvZiBmaWxlcyBpbiBwYXJhbGxlbCwgaXRcbiAgLy8gYmVjYW1lIGNvbW1vbiBlbm91Z2ggdG8gYmUgYSByZWFsIHJlbGlhYmlsaXR5IHByb2JsZW0uXG4gIGFwcC5wb3N0PHtcbiAgICBQYXJhbXM6IHsgdGVuYW50SWQ6IHN0cmluZyB9O1xuICAgIEJvZHk6IHsgZmlsZU5hbWU6IHN0cmluZzsgY29udGVudFR5cGU6IHN0cmluZzsgc2hpcG1lbnRJZD86IHN0cmluZzsgdXBsb2FkZWRCeTogc3RyaW5nOyBpbnRha2VTZXNzaW9uSWQ/OiBzdHJpbmcgfTtcbiAgfT4oXCIvdGVuYW50cy86dGVuYW50SWQvZG9jdW1lbnRzL3VwbG9hZC11cmxcIiwgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW5hbnRJZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgYXNzZXJ0VGVuYW50QWNjZXNzKHJlcXVlc3QuYXV0aCEsIHRlbmFudElkKTtcbiAgICBjb25zdCB7IGZpbGVOYW1lLCBjb250ZW50VHlwZSwgc2hpcG1lbnRJZCwgdXBsb2FkZWRCeSwgaW50YWtlU2Vzc2lvbklkIH0gPSByZXF1ZXN0LmJvZHk7XG5cbiAgICBjb25zdCBrZXkgPSBgdXBsb2Fkcy8ke3RlbmFudElkfS8ke2NyeXB0by5yYW5kb21VVUlEKCl9LSR7ZmlsZU5hbWV9YDtcblxuICAgIHJldHVybiB3aXRoVGVuYW50KHRlbmFudElkLCBhc3luYyAoY2xpZW50KSA9PiB7XG4gICAgICBjb25zdCB7IHJvd3MgfSA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgYElOU0VSVCBJTlRPIGRvY3VtZW50cyAodGVuYW50X2lkLCBzaGlwbWVudF9pZCwgZmlsZV9uYW1lLCBzM19rZXksIGRvY3VtZW50X3R5cGUsIHN0YXR1cywgdXBsb2FkZWRfYnksIGludGFrZV9zZXNzaW9uX2lkLCBpbnRha2Vfc291cmNlKVxuICAgICAgICAgVkFMVUVTICgkMSwgJDIsICQzLCAkNCwgJ1VOQ0xBU1NJRklFRCcsICdwZW5kaW5nX3VwbG9hZCcsICQ1LCAkNiwgJDcpXG4gICAgICAgICBSRVRVUk5JTkcgaWRgLFxuICAgICAgICBbXG4gICAgICAgICAgdGVuYW50SWQsXG4gICAgICAgICAgc2hpcG1lbnRJZCA/PyBudWxsLFxuICAgICAgICAgIGZpbGVOYW1lLFxuICAgICAgICAgIGtleSxcbiAgICAgICAgICB1cGxvYWRlZEJ5LFxuICAgICAgICAgIGludGFrZVNlc3Npb25JZCA/PyBudWxsLFxuICAgICAgICAgIGludGFrZVNlc3Npb25JZCA/IFwiYnVsa191cGxvYWRcIiA6IFwibWFudWFsX3VwbG9hZFwiLFxuICAgICAgICBdXG4gICAgICApO1xuXG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICBCdWNrZXQ6IERPQ1VNRU5UU19CVUNLRVQsXG4gICAgICAgIEtleToga2V5LFxuICAgICAgICBDb250ZW50VHlwZTogY29udGVudFR5cGUsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHVwbG9hZFVybCA9IGF3YWl0IGdldFNpZ25lZFVybChzMywgY29tbWFuZCwge1xuICAgICAgICBleHBpcmVzSW46IDMwMCxcbiAgICAgICAgLy8gT25seSBzaWduIHRoZSBob3N0IGhlYWRlci4gSWYgb3RoZXIgaGVhZGVycyAobGlrZSBjb250ZW50LXR5cGUpXG4gICAgICAgIC8vIGFyZSBzaWduZWQgaW50byB0aGUgVVJMLCB0aGUgYnJvd3NlciBhZGRzIGl0cyBvd24gc2VjLWZldGNoLSosXG4gICAgICAgIC8vIGFjY2VwdCwgZXRjLiBoZWFkZXJzIHRoYXQgZG9uJ3QgbWF0Y2ggdGhlIHNpZ25hdHVyZSAtPiA0MDNcbiAgICAgICAgLy8gU2lnbmF0dXJlRG9lc05vdE1hdGNoLiBLZWVwaW5nIFNpZ25lZEhlYWRlcnM9aG9zdCBvbmx5IG1lYW5zXG4gICAgICAgIC8vIHRoZSBicm93c2VyIGNhbiBzZW5kIHdoYXRldmVyIGV4dHJhIGhlYWRlcnMgaXQgd2FudHMgd2l0aG91dFxuICAgICAgICAvLyBicmVha2luZyB0aGUgc2lnbmF0dXJlLlxuICAgICAgICB1bmhvaXN0YWJsZUhlYWRlcnM6IG5ldyBTZXQoKSxcbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4geyB1cGxvYWRVcmwsIHMzS2V5OiBrZXksIGRvY3VtZW50SWQ6IHJvd3NbMF0uaWQgfTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgLy8gUEFUQ0ggL3RlbmFudHMvOnRlbmFudElkL2RvY3VtZW50cy86aWQvY29uZmlybS11cGxvYWRcbiAgLy8gQ2xpZW50IGNhbGxzIHRoaXMgYWZ0ZXIgdGhlIFMzIFBVVCBzdWNjZWVkcywgZmxpcHBpbmcgc3RhdHVzIGZyb21cbiAgLy8gXCJwZW5kaW5nX3VwbG9hZFwiIHRvIFwidXBsb2FkZWRcIi4gdHJpZ2dlci1waXBlbGluZSBvbmx5IHN0YXJ0cyBhXG4gIC8vIHBpcGVsaW5lIGV4ZWN1dGlvbiBmb3IgZG9jdW1lbnRzIGFscmVhZHkgcGFzdCBcInBlbmRpbmdfdXBsb2FkXCIg4oCUXG4gIC8vIGJlbHQtYW5kLXN1c3BlbmRlcnMgYWdhaW5zdCB0aGUgc2FtZSByYWNlIGZyb20gdGhlIG90aGVyIGRpcmVjdGlvblxuICAvLyAoYW4gRXZlbnRCcmlkZ2UgZXZlbnQgYXJyaXZpbmcgYmVmb3JlIHRoaXMgY29uZmlybSBjYWxsIHdvdWxkIG5vd1xuICAvLyBqdXN0IHNlZSBcInBlbmRpbmdfdXBsb2FkXCIgYW5kIHNraXAsIGluc3RlYWQgb2YgY3Jhc2hpbmcpLlxuICBhcHAucGF0Y2g8eyBQYXJhbXM6IHsgdGVuYW50SWQ6IHN0cmluZzsgaWQ6IHN0cmluZyB9IH0+KFxuICAgIFwiL3RlbmFudHMvOnRlbmFudElkL2RvY3VtZW50cy86aWQvY29uZmlybS11cGxvYWRcIixcbiAgICBhc3luYyAocmVxdWVzdCwgcmVwbHkpID0+IHtcbiAgICAgIGNvbnN0IHsgdGVuYW50SWQsIGlkIH0gPSByZXF1ZXN0LnBhcmFtcztcbiAgICAgIGFzc2VydFRlbmFudEFjY2VzcyhyZXF1ZXN0LmF1dGghLCB0ZW5hbnRJZCk7XG4gICAgICByZXR1cm4gd2l0aFRlbmFudCh0ZW5hbnRJZCwgYXN5bmMgKGNsaWVudCkgPT4ge1xuICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoXG4gICAgICAgICAgYFVQREFURSBkb2N1bWVudHMgU0VUIHN0YXR1cyA9ICd1cGxvYWRlZCcgV0hFUkUgaWQgPSAkMSBBTkQgdGVuYW50X2lkID0gJDIgQU5EIHN0YXR1cyA9ICdwZW5kaW5nX3VwbG9hZCdgLFxuICAgICAgICAgIFtpZCwgdGVuYW50SWRdXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcbiAgICAgIH0pO1xuICAgIH1cbiAgKTtcblxuICBhcHAuZ2V0PHsgUGFyYW1zOiB7IHRlbmFudElkOiBzdHJpbmcgfSB9PihcIi90ZW5hbnRzLzp0ZW5hbnRJZC9kb2N1bWVudHNcIiwgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgY29uc3QgeyB0ZW5hbnRJZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgYXNzZXJ0VGVuYW50QWNjZXNzKHJlcXVlc3QuYXV0aCEsIHRlbmFudElkKTtcblxuICAgIHJldHVybiB3aXRoVGVuYW50KHRlbmFudElkLCBhc3luYyAoY2xpZW50KSA9PiB7XG4gICAgICBjb25zdCB7IHJvd3MgfSA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgYFNFTEVDVCBpZCwgZmlsZV9uYW1lLCBkb2N1bWVudF90eXBlLCBzdGF0dXMsIGludGFrZV9zb3VyY2UsIHVwbG9hZGVkX2F0XG4gICAgICAgICBGUk9NIGRvY3VtZW50cyBXSEVSRSB0ZW5hbnRfaWQgPSAkMSBPUkRFUiBCWSB1cGxvYWRlZF9hdCBERVNDIExJTUlUIDIwMGAsXG4gICAgICAgIFt0ZW5hbnRJZF1cbiAgICAgICk7XG4gICAgICByZXR1cm4gcm93cztcbiAgICB9KTtcbiAgfSk7XG5cbiAgYXBwLmdldDx7IFBhcmFtczogeyB0ZW5hbnRJZDogc3RyaW5nOyBpZDogc3RyaW5nIH0gfT4oXG4gICAgXCIvdGVuYW50cy86dGVuYW50SWQvZG9jdW1lbnRzLzppZFwiLFxuICAgIGFzeW5jIChyZXF1ZXN0LCByZXBseSkgPT4ge1xuICAgICAgY29uc3QgeyB0ZW5hbnRJZCwgaWQgfSA9IHJlcXVlc3QucGFyYW1zO1xuICAgICAgYXNzZXJ0VGVuYW50QWNjZXNzKHJlcXVlc3QuYXV0aCEsIHRlbmFudElkKTtcbiAgICAgIHJldHVybiB3aXRoVGVuYW50KHRlbmFudElkLCBhc3luYyAoY2xpZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHsgcm93cyB9ID0gYXdhaXQgY2xpZW50LnF1ZXJ5KFxuICAgICAgICAgIGBTRUxFQ1QgaWQsIHNoaXBtZW50X2lkLCBmaWxlX25hbWUsIGRvY3VtZW50X3R5cGUsIHN0YXR1cywgaW50YWtlX3NvdXJjZSwgczNfa2V5LCB1cGxvYWRlZF9hdFxuICAgICAgICAgICBGUk9NIGRvY3VtZW50cyBXSEVSRSBpZCA9ICQxIEFORCB0ZW5hbnRfaWQgPSAkMmAsXG4gICAgICAgICAgW2lkLCB0ZW5hbnRJZF1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gcmVwbHkuY29kZSg0MDQpLnNlbmQoeyBlcnJvcjogXCJEb2N1bWVudCBub3QgZm91bmRcIiB9KTtcbiAgICAgICAgcmV0dXJuIHJvd3NbMF07XG4gICAgICB9KTtcbiAgICB9XG4gICk7XG5cbiAgYXBwLmdldDx7IFBhcmFtczogeyB0ZW5hbnRJZDogc3RyaW5nOyBpZDogc3RyaW5nIH0gfT4oXG4gICAgXCIvdGVuYW50cy86dGVuYW50SWQvZG9jdW1lbnRzLzppZC9kb3dubG9hZC11cmxcIixcbiAgICBhc3luYyAocmVxdWVzdCwgcmVwbHkpID0+IHtcbiAgICAgIGNvbnN0IHsgdGVuYW50SWQsIGlkIH0gPSByZXF1ZXN0LnBhcmFtcztcbiAgICAgIGFzc2VydFRlbmFudEFjY2VzcyhyZXF1ZXN0LmF1dGghLCB0ZW5hbnRJZCk7XG4gICAgICByZXR1cm4gd2l0aFRlbmFudCh0ZW5hbnRJZCwgYXN5bmMgKGNsaWVudCkgPT4ge1xuICAgICAgICBjb25zdCB7IHJvd3MgfSA9IGF3YWl0IGNsaWVudC5xdWVyeShcbiAgICAgICAgICBgU0VMRUNUIHMzX2tleSBGUk9NIGRvY3VtZW50cyBXSEVSRSBpZCA9ICQxIEFORCB0ZW5hbnRfaWQgPSAkMmAsXG4gICAgICAgICAgW2lkLCB0ZW5hbnRJZF1cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gcmVwbHkuY29kZSg0MDQpLnNlbmQoeyBlcnJvcjogXCJEb2N1bWVudCBub3QgZm91bmRcIiB9KTtcbiAgICAgICAgY29uc3QgeyBHZXRPYmplY3RDb21tYW5kIH0gPSBhd2FpdCBpbXBvcnQoXCJAYXdzLXNkay9jbGllbnQtczNcIik7XG4gICAgICAgIGNvbnN0IHsgZ2V0U2lnbmVkVXJsIH0gPSBhd2FpdCBpbXBvcnQoXCJAYXdzLXNkay9zMy1yZXF1ZXN0LXByZXNpZ25lclwiKTtcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBHZXRPYmplY3RDb21tYW5kKHsgQnVja2V0OiBET0NVTUVOVFNfQlVDS0VULCBLZXk6IHJvd3NbMF0uczNfa2V5IH0pO1xuICAgICAgICBjb25zdCBkb3dubG9hZFVybCA9IGF3YWl0IGdldFNpZ25lZFVybChzMywgY29tbWFuZCwgeyBleHBpcmVzSW46IDM2MDAgfSk7XG4gICAgICAgIHJldHVybiB7IGRvd25sb2FkVXJsIH07XG4gICAgICB9KTtcbiAgICB9XG4gICk7XG5cbiAgYXBwLmdldDx7IFBhcmFtczogeyB0ZW5hbnRJZDogc3RyaW5nOyBpZDogc3RyaW5nIH0gfT4oXG4gICAgXCIvdGVuYW50cy86dGVuYW50SWQvZG9jdW1lbnRzLzppZC9leHRyYWN0ZWQtZmllbGRzXCIsXG4gICAgYXN5bmMgKHJlcXVlc3QsIHJlcGx5KSA9PiB7XG4gICAgICBjb25zdCB7IHRlbmFudElkLCBpZCB9ID0gcmVxdWVzdC5wYXJhbXM7XG4gICAgICBhc3NlcnRUZW5hbnRBY2Nlc3MocmVxdWVzdC5hdXRoISwgdGVuYW50SWQpO1xuICAgICAgcmV0dXJuIHdpdGhUZW5hbnQodGVuYW50SWQsIGFzeW5jIChjbGllbnQpID0+IHtcbiAgICAgICAgY29uc3QgeyByb3dzIH0gPSBhd2FpdCBjbGllbnQucXVlcnkoXG4gICAgICAgICAgYFNFTEVDVCBmcy5pZCwgY2YuZmllbGRfa2V5LCBmcy5yYXdfdmFsdWUsIGZzLmNvbmZpZGVuY2UsIGZzLnJlYXNvbmluZyxcbiAgICAgICAgICAgICAgICAgIGNmLnJlc29sdmVkX3ZhbHVlLCBjZi5zdGF0dXMgYXMgZmllbGRfc3RhdHVzXG4gICAgICAgICAgIEZST00gY3RkbV9maWVsZF9zb3VyY2VzIGZzXG4gICAgICAgICAgIEpPSU4gY3RkbV9maWVsZHMgY2YgT04gY2YuaWQgPSBmcy5jdGRtX2ZpZWxkX2lkXG4gICAgICAgICAgIFdIRVJFIGZzLmRvY3VtZW50X2lkID0gJDEgQU5EIGNmLnRlbmFudF9pZCA9ICQyXG4gICAgICAgICAgIE9SREVSIEJZIGZzLmNvbmZpZGVuY2UgREVTQ2AsXG4gICAgICAgICAgW2lkLCB0ZW5hbnRJZF1cbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIHJvd3M7XG4gICAgICB9KTtcbiAgICB9XG4gICk7XG59XG4iXX0=