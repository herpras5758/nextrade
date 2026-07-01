import { Handler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand,
  AdminAddUserToGroupCommand, AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';
import { DOC_TYPE_DEFAULTS } from '../shared/docTypeDefaults.js';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler: Handler = async () => {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO tenants (code, name, default_language)
       VALUES ('USG','PT Ungaran Sari Garments','id')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    const tenantId = rows[0].id;

    const writer = new EvidenceWriter(client);
    await writer.writeEvent({
      tenantId, eventTime: new Date(),
      eventType: 'SHIPMENT_CREATED', producerType: 'SYSTEM', entityType: 'SHIPMENT',
      payload: { type: 'TENANT_BOOTSTRAPPED', tenant_code: 'USG', schema_version: '2.0' },
    });

    try {
      await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID, Username: 'admin@ungaransari.test',
        TemporaryPassword: 'NexTrade2026Temp!', MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: 'admin@ungaransari.test' },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'given_name', Value: 'Admin' },
          { Name: 'family_name', Value: 'PT Ungaran Sari Garments' },
          { Name: 'custom:tenant_ids', Value: tenantId },
          { Name: 'custom:preferred_lang', Value: 'id' },
        ],
      }));
      await cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID, Username: 'admin@ungaransari.test',
        Password: 'NexTrade2026Admin!', Permanent: true,
      }));
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID, Username: 'admin@ungaransari.test', GroupName: 'admin',
      }));
    } catch (e: any) {
      if (!e.message?.includes('exists')) throw e;
    }


    // Seed doc type + field configs (config-driven, Rule #4)
    for (const docType of DOC_TYPE_DEFAULTS) {
      await client.query(
        `INSERT INTO tenant_doc_type_config
           (tenant_id, doc_type_code, display_name, category, classification_hints, is_enabled)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (tenant_id, doc_type_code) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           classification_hints = EXCLUDED.classification_hints,
           updated_at = NOW()`,
        [tenantId, docType.doc_type_code, docType.display_name, docType.category, docType.classification_hints]
      );
      for (const field of docType.fields) {
        await client.query(
          `INSERT INTO tenant_doc_field_config
             (tenant_id, doc_type_code, field_key, display_name, is_enabled,
              is_mandatory, is_mandatory_ceisa, ceisa_field_ref,
              confidence_threshold, sort_order)
           VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, doc_type_code, field_key) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             is_mandatory = EXCLUDED.is_mandatory,
             is_mandatory_ceisa = EXCLUDED.is_mandatory_ceisa,
             updated_at = NOW()`,
          [tenantId, docType.doc_type_code, field.field_key, field.display_name,
           field.is_mandatory, field.is_mandatory_ceisa,
           field.ceisa_field_ref ?? null, field.confidence_threshold ?? null, field.sort_order]
        );
      }
    }

    await client.query('COMMIT');
    return { success: true, tenantId, message: 'Seed v2.0 complete' };
  } catch (err: any) {
    await client.query('ROLLBACK');
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};
