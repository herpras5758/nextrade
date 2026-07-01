import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';
import { EvidenceWriter } from '../../../lambda/shared/evidence/index.js';
import { createCeisaAdapter } from '../../../lambda/shared/ceisa/index.js';
import { mapBC23Payload } from '../lib/mappers/ceisaMapper.js';

export async function ceisaSubmitRoutes(app: FastifyInstance) {

  // POST /tenants/:id/shipments/:sid/ceisa-submit
  // The submission endpoint — enforces READY_FOR_CEISA state, submits via adapter.
  app.post<{ Params: { tenantId: string; shipmentId: string } }>(
    '/tenants/:tenantId/shipments/:shipmentId/ceisa-submit',
    async (req, reply) => {
      const { tenantId, shipmentId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        // 1. Verify state machine: only READY_FOR_CEISA can submit
        const { rows: [shipment] } = await client.query(
          `SELECT id, shipment_number, status FROM shipments WHERE id = $1 AND tenant_id = $2`,
          [shipmentId, tenantId]
        );
        if (!shipment) return reply.code(404).send({ error: 'Shipment not found' });
        if (shipment.status !== 'READY_FOR_CEISA') {
          return reply.code(409).send({
            error: `Cannot submit: shipment is ${shipment.status}, must be READY_FOR_CEISA`,
            current_status: shipment.status,
          });
        }

        // 2. Load tenant CEISA config (mock vs live, Addendum F)
        const { rows: [aiCfg] } = await client.query(
          `SELECT ceisa_mode, ceisa_endpoint, ceisa_api_key FROM tenant_ai_config WHERE tenant_id = $1`,
          [tenantId]
        );
        const ceisaMode = aiCfg?.ceisa_mode ?? 'mock';
        const adapter = createCeisaAdapter(ceisaMode, aiCfg?.ceisa_endpoint, aiCfg?.ceisa_api_key);

        // 3. Build BC 2.3 payload from CTDM
        const payload = await mapBC23Payload(client, shipmentId, tenantId);

        // 4. Submit via adapter
        const submitResult = await adapter.submit({
          bc_type: 'BC_2_3',
          nomor_aju: shipment.shipment_number,
          tenant_id: tenantId,
          payload,
        });

        // 5. Write evidence event regardless of success/failure
        const writer = new EvidenceWriter(client);
        const evt = await writer.writeEvent({
          tenantId, eventTime: new Date(),
          eventType: submitResult.success ? 'SHIPMENT_STATUS_CHANGED' : 'REASONING_TRIGGERED' as any,
          producerType: 'SYSTEM', producerRef: shipmentId,
          entityType: 'SHIPMENT', entityId: shipmentId,
          payload: {
            from_status: 'READY_FOR_CEISA',
            to_status: submitResult.success ? 'SUBMITTED' : 'READY_FOR_CEISA',
            ceisa_mode: ceisaMode,
            nomor_permohonan: submitResult.nomor_permohonan,
            nomor_bc: submitResult.nomor_bc,
            ceisa_status: submitResult.status,
            message: submitResult.message,
          },
        });

        if (submitResult.success) {
          // 6. Advance state machine to SUBMITTED
          await client.query(
            `UPDATE shipments SET status = 'SUBMITTED', last_event_id = $1, last_event_seq = $2 WHERE id = $3`,
            [evt.id, evt.sequenceNum, shipmentId]
          );

          // 7. Store CEISA reference numbers in ctdm_fields
          if (submitResult.nomor_bc) {
            await client.query(
              `INSERT INTO ctdm_fields (tenant_id, shipment_id, field_key, resolved_value, confidence, status, last_event_id)
               VALUES ($1,$2,'nomor_bc',$3,1.0,'auto_approved',$4)
               ON CONFLICT DO NOTHING`,
              [tenantId, shipmentId, submitResult.nomor_bc, evt.id]
            );
          }
        }

        return {
          success: submitResult.success,
          ceisa_mode: ceisaMode,
          nomor_permohonan: submitResult.nomor_permohonan,
          nomor_bc: submitResult.nomor_bc,
          tanggal_bc: submitResult.tanggal_bc,
          status: submitResult.status,
          message: submitResult.message,
          shipment_status: submitResult.success ? 'SUBMITTED' : shipment.status,
        };
      });
    }
  );

  // GET /tenants/:id/shipments/:sid/sppb — check SPPB status
  app.get<{ Params: { tenantId: string; shipmentId: string } }>(
    '/tenants/:tenantId/shipments/:shipmentId/sppb',
    async (req, reply) => {
      const { tenantId, shipmentId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        // Load nomor_bc from ctdm_fields
        const { rows: [bcField] } = await client.query(
          `SELECT resolved_value FROM ctdm_fields
           WHERE shipment_id = $1 AND field_key = 'nomor_bc' AND tenant_id = $2`,
          [shipmentId, tenantId]
        );
        if (!bcField) return reply.code(404).send({ error: 'No nomor_bc found — shipment not submitted yet' });

        const { rows: [aiCfg] } = await client.query(
          `SELECT ceisa_mode, ceisa_endpoint, ceisa_api_key FROM tenant_ai_config WHERE tenant_id = $1`,
          [tenantId]
        );
        const adapter = createCeisaAdapter(aiCfg?.ceisa_mode ?? 'mock', aiCfg?.ceisa_endpoint, aiCfg?.ceisa_api_key);
        const sppb = await adapter.getSPPB(bcField.resolved_value);

        if (sppb?.status === 'ISSUED') {
          // Advance state to SPPB
          const writer = new EvidenceWriter(client);
          const evt = await writer.writeEvent({
            tenantId, eventTime: new Date(), eventType: 'SHIPMENT_STATUS_CHANGED',
            producerType: 'SYSTEM', producerRef: shipmentId,
            entityType: 'SHIPMENT', entityId: shipmentId,
            payload: { from_status: 'SUBMITTED', to_status: 'SPPB', nomor_sppb: sppb.nomor_sppb },
          });
          await client.query(
            `UPDATE shipments SET status = 'SPPB', last_event_id = $1 WHERE id = $2 AND status = 'SUBMITTED'`,
            [evt.id, shipmentId]
          );
        }

        return sppb;
      });
    }
  );
}
