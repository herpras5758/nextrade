# NexTrade Backend — Changelog

Setiap kali saya kirim ulang `nextrade-backend-vX.tar.gz`, versi itu
menggantikan TOTAL semua versi sebelumnya — selalu pakai nomor tertinggi.

## v4 - 2026-06-30
- FIX KRITIS: em-dash di DbSecurityGroup description (data-stack.ts)
  balik lagi di v2/v3 karena fix sebelumnya cuma di-apply manual lewat
  sed di CloudShell user, tidak pernah disinkronkan ke source asli saya.
  Sekarang sudah di-scan ulang SEMUA file (lib/stacks, bin, api/src)
  untuk karakter non-ASCII di string literal manapun, bukan cuma satu
  titik yang dilaporkan error.

## v3 - 2026-06-30
- FIX KRITIS: Compute Stack sebelumnya pakai image placeholder
  node:20-alpine yang tidak pernah listen di port 3000 -> health check
  ALB tidak pernah lolos -> ECS service stuck CREATE_IN_PROGRESS selamanya.
- Compute Stack sekarang pakai ecs.ContainerImage.fromAsset() -> CDK
  otomatis build Docker image dari Dockerfile + kode API asli saat
  cdk deploy, tidak perlu lagi langkah manual docker build/push terpisah.

## v2 - 2026-06-30
- Tambah Cache Stack (ElastiCache Redis Multi-AZ)
- Tambah Search Stack (OpenSearch, Trade Intelligence Engine)
- Tambah API service lengkap (Fastify)

## v1 - 2026-06-30
- Network/Data/Auth/Storage/Pipeline/Compute Stack awal

## v5 - 2026-06-30 (patch applied live via sed, source updated for record)
- FIX: Cache Stack node type cache.t4g.small -> cache.t3.small
  (Graviton/t4g not available in ap-southeast-3)
- FIX: Cache Stack pin engineVersion to "6.0" (verified actually
  available in ap-southeast-3, newer 7.x not yet rolled out there)

## v6 - 2026-06-30
- Implementasi NYATA pipeline ekstraksi (sebelumnya placeholder):
  - lambda/classify-document - klasifikasi dokumen via Bedrock dari isi
    teks (Textract DetectDocumentText), bukan dari nama file
  - lambda/extract-fields - Textract AnalyzeDocument (FORMS+TABLES) +
    Bedrock untuk mapping ke CTDM fields dengan confidence & reasoning
  - lambda/reconcile-fields - Source Resolution + Smart Reconciliation
    sungguhan, termasuk normalisasi angka lintas format (lihat
    lambda/shared/numberFormat.ts) sehingga "4,415.30" (invoice),
    "4415.3000" (BL), "4.415,3000" (BC 2.3 format Indonesia) dikenali
    sebagai NILAI YANG SAMA, bukan konflik
  - lambda/item-match - fuzzy matching Levenshtein + threshold 0.75
  - lambda/ctdm-write - update status dokumen + hitung ulang CEISA
    Readiness Score
  - lambda/trigger-pipeline - benar-benar start Step Functions
    execution dari EventBridge event, lookup shipment dari DB
- Tambah lib/bcTypes.ts (frontend): Letter of Guarantee dan Inward
  Manifest BC 1.1 sebagai dokumen wajib BC 2.3 (ditemukan dari analisa
  sample shipment OBOR/Ungaran Sari Garments)
- Pipeline Stack sekarang pakai NodejsFunction (real esbuild bundling
  dari source asli), bukan lambda.Code.fromInline placeholder
- Tambah dependency: pg, @aws-sdk/client-textract, @aws-sdk/client-sfn,
  @aws-sdk/client-s3, @aws-sdk/client-secrets-manager, esbuild

## v7 - 2026-06-30
- Tambah Document Linking Engine (lambda/link-shipment): otomatis
  mengelompokkan dokumen terpisah ke shipment yang sama berdasarkan
  nomor referensi silang, persis pola dari sample shipment:
    PO 1409443 -> Invoice/PackingList 0126051 -> BL/LOG/Manifest
    DFS717006813 -> PIB cross-reference ketiganya sekaligus
- Tambah tabel document_references di schema.sql (lookup nomor referensi
  lintas dokumen, indexed)
- PIB/BC 2.3 sekarang divalidasi: kalau salah satu dari PO/Invoice/BL
  yang dirujuknya tidak ditemukan di dokumen lain, muncul sebagai
  crossCheckIssues, bukan diam-diam diabaikan
- Pipeline Step Functions bertambah 1 step: Extract -> LinkShipment ->
  Reconcile -> ItemMatch -> CtdmWrite
- extract-fields field map ditambah field referensi (po_number,
  invoice_number, bl_number, manifest_number) per tipe dokumen, dan tipe
  dokumen baru "BC 2.3 Declaration"

## v8 - 2026-06-30
- Tambah Validation Engine (lambda/link-shipment, diperluas): mendeteksi
  KONTRADIKSI nomor referensi antar dokumen dalam shipment yang sama
  (bukan cuma "tidak ketemu match"). Contoh kasus nyata yang diminta:
  Invoice + Packing List sepakat invoice_number 0126051, dokumen lain
  bilang 0126057 untuk shipment yang sama -> Validation Error eksplisit,
  bukan diam-diam diterima.
- Tabel baru: validation_errors (schema.sql)
- API baru: GET .../shipments/:id/validation-errors,
  POST .../validation-errors/:id/resolve

## v9 - 2026-06-30
- Audit terhadap 13-modul IDP Engine (Document Intake -> ERP Mapping),
  tutup 3 gap: 
  - lib/shipmentStatus.ts: status terpadu READY_FOR_CEISA / NEEDS_REVIEW
    / DOCUMENT_MISMATCH / DRAFT, prioritas mismatch > review > ready
  - routes/review.ts: GET .../shipments/:id/status, GET
    .../review-queue (Human Review Queue lintas shipment), GET
    .../shipments/:id/evidence-registry (Evidence Registry lengkap:
    field + sources + audit trail)
  - ctdm-write Lambda sekarang menulis unified status ke shipments.status
    setiap kali pipeline jalan
- Gap masih terbuka (belum dikerjakan, dicatat eksplisit, bukan
  diabaikan): Image Enhancement, AI Validation (business-rule, bukan
  cuma confidence), CEISA Mapping (transformer ke payload CEISA),
  ERP Mapping

## v10 - 2026-06-30
Menutup 4 gap terakhir dari audit 13-modul IDP Engine. SEMUA modul kini
ada implementasi nyata (bukan placeholder):

- Image Enhancement (lambda/enhance-image): grayscale + contrast
  normalize + despeckle + sharpen pakai Sharp, jalan di awal pipeline
  untuk upload raster (JPG/PNG/TIFF dari scan/foto). PDF native
  skip stage ini (Textract sudah handle baik). Deskew (koreksi rotasi)
  BELUM ada — dicatat eksplisit sebagai gap nyata, bukan dipalsukan
  dengan rotate sudut tetap yang bisa merusak dokumen yang tidak miring.
- AI Validation (lambda/ai-validate + shared/businessValidation.ts):
  validasi aturan bisnis config-driven (format HS code, berat harus
  positif, tanggal tidak boleh masa depan/terlalu lama) -- terpisah
  dari confidence score Reconciliation Engine. Tabel baru:
  business_validation_results.
- CEISA Mapping (lib/mappers/ceisaMapper.ts): transform CTDM -> struktur
  payload BC 2.3 (field by field, sesuai layout PIB form asli). Endpoint
  GET .../shipments/:id/ceisa-payload, MENOLAK generate kalau status
  shipment bukan READY_FOR_CEISA. Transport submission ke API CEISA
  sungguhan BELUM ada (butuh kredensial/dokumentasi API dari Bea Cukai
  yang belum kita punya) -- dicatat eksplisit, bukan dipalsukan.
- ERP Mapping (lib/erp-adapters/erpAdapter.ts): adapter pattern (Rule
  #10) + config-driven field mapping (contoh: mapping SAP EKKO/EKPO).
  Koneksi nyata ke SAP/Oracle/dll BELUM ada (butuh kredensial per
  tenant) -- UnconfiguredERPAdapter mengembalikan error jelas, bukan
  pura-pura sukses.

Pipeline Step Functions sekarang 7 step:
  EnhanceImage -> Classify -> Extract -> LinkShipment -> Reconcile ->
  AiValidate -> ItemMatch -> CtdmWrite

CATATAN: EnhanceImageFn pakai forceDockerBundling (sharp butuh native
binary Linux x64) -- pastikan docker tersedia saat cdk deploy.

## v11 - 2026-06-30
- BACKLOG DICATAT (PROJECT_RULES.md Addendum F): semua AI/tools "otak"
  sistem (AI Engine provider/model, OCR, ERP adapter, CEISA endpoint,
  reconciliation threshold) WAJIB configurable dari Frontend Settings,
  BUKAN hardcode di environment variable. Ini utang teknis resmi,
  belum dikerjakan penuh -- DEFAULT_AI_ENGINE_CONFIG di
  ai-engine-adapter/index.ts MASIH hardcoded, perlu diganti baca dari
  tabel tenant_ai_config setelah pipeline inti stabil.
- Tambah tabel tenant_ai_config (schema.sql) sebagai fondasi -- supaya
  migration besar tidak perlu dilakukan belakangan. Key-value JSONB per
  tenant, RLS terpasang.
- ENV variable yang TETAP boleh ada (bukan bagian "otak"): DB secret
  ARN, S3 bucket name -- itu pengkabelan infrastruktur, bukan
  konfigurasi AI/business logic.

## v12 - 2026-06-30
- FIX: hapus forceDockerBundling dari EnhanceImageFn (Sharp). CloudShell
  host (Amazon Linux x64) sudah cocok dengan arsitektur Lambda runtime,
  jadi bundling esbuild lokal sudah cukup -- Docker cross-compilation
  cuma buang-buang kuota disk CloudShell yang sangat terbatas tanpa
  manfaat tambahan di environment ini.

## v13 - 2026-06-30
Solusi untuk 3 pola upload nyata (per-file, gabung 1 shipment, bulk
ratusan file sekaligus):

- FIX race condition: dokumen row sekarang dibuat SEBELUM presigned URL
  diberikan (bukan sesudah upload selesai). POST /documents/upload-url
  sekarang langsung INSERT row dengan status 'pending_upload', baru
  generate presigned URL. Endpoint baru: PATCH
  .../documents/:id/confirm-upload untuk konfirmasi setelah S3 PUT
  sukses. trigger-pipeline skip eksekusi kalau status masih
  pending_upload (defense kedua).
- Tambah kolom documents.intake_session_id -- hint UI untuk "kelompok
  upload yang sama", BUKAN sumber kebenaran (Document Linking Engine
  via nomor referensi tetap yang menentukan shipment akhir).
- THROTTLING burst upload: EventBridge sekarang target ke SQS queue
  (PipelineTriggerQueue) dulu, bukan langsung Lambda. trigger-pipeline
  dapat reservedConcurrentExecutions=5 -- mencegah 200 file upload
  bersamaan memicu 200 Step Functions execution simultan yang akan
  kena throttle Textract/Bedrock. DLQ existing (deadLetterQueue) sekarang
  benar-benar terpakai (maxReceiveCount 3).

BELUM dikerjakan (next): UI Bulk Upload di frontend (drag banyak file,
progress queue per file, intake session grouping) -- backend sudah
siap menerimanya, tinggal wiring UI.

## v14 - 2026-06-30
Fitur baru: Email Intake ("no human touch" lewat email).

Desain terkonfirmasi:
- Mode: AUTO-FORWARDING RULE di mailbox asli user (Gmail/Outlook
  level mail-server, BUKAN tombol "Forward" manual -- supaya header
  From asli supplier/forwarder tetap terjaga untuk validasi sender).
  OAuth langsung ke mailbox (Gmail/Outlook API) dicatat sebagai opsi
  fase berikutnya, belum dikerjakan.
- Lampiran masuk lewat S3 prefix uploads/ yang SAMA dengan upload
  manual -> otomatis lewat 9-stage pipeline yang sudah ada, TANPA kode
  pipeline baru. Document Linking Engine tetap yang menentukan
  shipment (auto-buat baru kalau tidak ada yang cocok).
- BERHENTI di READY_FOR_CEISA -- Lambda ini TIDAK PERNAH submit ke
  CEISA. Approval manusia tetap wajib sebelum payload benar-benar
  terkirim ke Bea Cukai (keputusan eksplisit, dikonfirmasi user).

Yang dibangun:
- lambda/parse-inbound-email: parse MIME (mailparser), validasi sender
  terhadap allowlist (SATU-SATUNYA security boundary untuk jalur ini,
  karena bypass auth Cognito normal), extract attachment, ingest ke
  pipeline dengan urutan anti-race yang sama seperti v13.
- Tabel baru: email_intake_config (alamat intake + allowlist sender per
  tenant), email_intake_log (audit, termasuk percobaan ditolak)
- lib/stacks/email-intake-stack.ts: SES domain identity + receipt rule
  + S3 raw email bucket. PENTING: stack ini TIDAK auto-deploy, perlu
  context flag eksplisit:
    cdk deploy NexTrade-EmailIntake -c intakeDomain=mail.nextrade.id -c emailRegion=us-east-1
- API: GET/PUT .../email-intake-config (PUT admin-only), GET
  .../email-intake-log

CATATAN BELUM SELESAI (prasyarat di luar kendali kode):
- SES inbound receiving KEMUNGKINAN BESAR belum tersedia di
  ap-southeast-3 -- perlu verifikasi `aws ses describe-receipt-rule-set
  --region <kandidat>` sebelum deploy. Default sementara: us-east-1.
- Perlu domain yang DIMILIKI dan bisa diatur DNS-nya (MX record ke SES)
  -- ini bukan sesuatu yang bisa saya sediakan, perlu keputusan domain
  dari Anda (subdomain dari domain NexTrade, atau domain tenant sendiri).
- Lambda parse-inbound-email TIDAK ada di VPC Jakarta (lintas region),
  akses RDS lewat endpoint publik -- perlu hardening lanjutan (idealnya
  lewat internal API endpoint, bukan query Postgres langsung
  cross-region) sebelum production.

## v15 - 2026-06-30
Identity tracking untuk SETIAP sumber dokumen (diminta sebelum v14
email intake di-deploy):

- Kolom baru documents.intake_source (manual_upload | bulk_upload |
  email_intake | api | ftp | edi) dan documents.intake_metadata (JSONB,
  detail spesifik per sumber -- untuk email: sender address, subject,
  messageId)
- lib/intakeSources.ts: registry config-driven (Rule #4 + Rule #10) --
  daftar SEMUA channel intake yang dikenal sistem, status
  active/planned/disabled, apakah bisa di-toggle admin per tenant.
  Menambah channel baru (API, FTP, EDI -- semua sudah disebut di
  vision doc) = tambah 1 entry di sini, bukan kolom/logic baru.
- API baru: GET /intake-sources (registry lengkap, untuk render
  Settings > Integrations di frontend), GET
  .../documents/source-summary (hitung dokumen per sumber per tenant)
- Manual upload routes & parse-inbound-email sekarang konsisten isi
  intake_source yang benar (bulk_upload otomatis terdeteksi dari ada/
  tidaknya intakeSessionId, email_intake selalu eksplisit dengan
  metadata sender/subject/messageId tersimpan)

Dengan ini, "dokumen ini datang dari mana" terjawab untuk SETIAP
dokumen di sistem, bukan cuma yang dari email -- fondasi sebelum
channel intake lain (API/FTP/EDI) ditambahkan nanti.

## v16 - 2026-06-30
Hubungkan intake_source identity tracking ke Dashboard & Reporting
(diminta supaya tidak jadi data mati):

- API baru: GET .../dashboard/summary -- SATU endpoint gabungan:
  status shipment terpadu (READY_FOR_CEISA/NEEDS_REVIEW/
  DOCUMENT_MISMATCH/DRAFT), breakdown dokumen per intake_source,
  jumlah shipment pending review, jumlah shipment document mismatch,
  Auto-Approval Rate SUNGGUHAN (dihitung dari rasio ctdm_fields
  AUTO_APPROVED vs total -- bukan placeholder "-" lagi), dan 10
  dokumen terbaru. Dashboard frontend baca dari SATU endpoint ini,
  bukan 4 panggilan terpisah yang bisa beda hasil.

## v17 - 2026-06-30
- FIX: reservedConcurrentExecutions=5 di TriggerPipelineFn ditolak AWS
  karena akun ini punya total concurrency limit kecil, dan AWS wajibkan
  minimal 10 unreserved tersisa di level akun. Ganti ke maxConcurrency=5
  di level SQS event source (lambdaEventSources.SqsEventSource) --
  throttling yang sama efeknya, tapi TIDAK memotong kuota reserved
  account-wide, jadi tidak akan gagal lagi di akun dengan limit kecil.

## v18 - 2026-06-30
- Tambah ApplySchemaFn (lambda/apply-schema) di Data Stack -- Lambda
  sekali-pakai untuk apply db/schema.sql ke RDS tanpa perlu bastion/EC2.
  RDS ada di isolated subnet (tidak ada akses internet sengaja, Security
  First), jadi CloudShell tidak bisa psql langsung -- Lambda ini di VPC
  yang sama jadi bisa connect, dipicu manual sekali lewat aws lambda
  invoke, BUKAN auto-run tiap deploy (schema.sql bukan idempotent,
  re-run akan gagal di percobaan kedua).
- Cara pakai setelah redeploy NexTrade-Data:
    aws lambda invoke --function-name nextrade-apply-schema --region ap-southeast-3 /tmp/out.json
    cat /tmp/out.json

## v19 - 2026-06-30 (FIX KRITIS - mempengaruhi SEMUA Lambda pipeline)
- FIX: dbSecurityGroup dibuat dengan allowAllOutbound:false TANPA satu
  pun egress rule -- efeknya DENY SEMUA outbound, termasuk HTTPS ke
  Secrets Manager. Karena SEMUA 9 Lambda di Pipeline Stack (classify,
  extract, link-shipment, reconcile, ai-validate, item-match,
  ctdm-write, trigger-pipeline) DAN ApplySchemaFn pakai security group
  yang SAMA PERSIS dengan RDS, mereka semua kemungkinan besar diam-diam
  TIDAK BISA konek ke Secrets Manager maupun RDS sejak pertama deploy --
  CloudFormation tidak mendeteksi ini karena cuma cek resource
  ke-create, bukan cek konektivitas jaringan sungguhan.
- Ditemukan lewat test manual aws lambda invoke ApplySchemaFn yang
  gagal dengan TimeoutError -- bukti nyata kenapa testing end-to-end
  penting, bukan cuma percaya status CREATE_COMPLETE/UPDATE_COMPLETE.
- Tambah 2 egress rule eksplisit ke dbSecurityGroup: port 5432 ke VPC
  CIDR (traffic Postgres antar resource dalam VPC), port 443 ke
  0.0.0.0/0 (HTTPS keluar lewat NAT untuk Secrets Manager dkk).
- WAJIB redeploy NexTrade-Data DULU (security group didefinisikan di
  sana), baru NexTrade-Pipeline ikut menerima security group yang
  sudah diperbaiki (resource reference, tidak perlu redeploy isi
  Pipeline Stack itu sendiri, cukup Data Stack).

## v20 - 2026-06-30
Setup GitHub Actions (solusi permanen masalah disk CloudShell):

- lib/stacks/github-oidc-stack.ts: IAM OIDC provider + role untuk
  GitHub Actions, di-trust HANYA untuk repo+branch spesifik (kondisi
  StringLike pada sub claim token OIDC). Role ini TIDAK punya
  permission langsung apapun -- satu-satunya policy-nya adalah
  sts:AssumeRole ke role bootstrap CDK yang SAMA yang sudah dipakai
  CloudShell (cdk-hnb659fds-*). Tidak ada permukaan privilege baru.
- .github/workflows/deploy.yml: manual trigger (workflow_dispatch),
  pilih stack dari dropdown, jalan di ubuntu-latest (~14GB disk, vs
  CloudShell ~1GB) -- ENOSPC yang berulang kali kita alami tidak akan
  terjadi lagi di sini.
- .gitignore ditambahkan.

CARA SETUP (urutan):
1. Deploy stack OIDC ini SEKALI lewat CloudShell (yang terakhir kali
   perlu CloudShell untuk infra):
     cdk deploy NexTrade-GitHubOidc -c githubOrg=<org> -c githubRepo=<repo> --exclusively
2. Catat output GitHubDeployRoleArn
3. Buat repo GitHub (kalau belum ada), push folder nextrade-backend
   sebagai isi repo (root repo = nextrade-backend, atau sesuaikan
   working-directory di workflow kalau struktur beda)
4. Di GitHub repo Settings > Secrets and variables > Actions, tambah:
   - AWS_DEPLOY_ROLE_ARN = (GitHubDeployRoleArn dari langkah 2)
   - AWS_REGION = ap-southeast-3
5. Tab Actions di GitHub -> pilih workflow "Deploy NexTrade Backend" ->
   Run workflow -> pilih stack dari dropdown -> Run

Setelah ini, SEMUA deploy berikutnya (Pipeline, Compute, dst) bisa
lewat GitHub Actions, tidak perlu CloudShell lagi.

## v21 - 2026-06-30
- FIX: OIDC provider GitHub (token.actions.githubusercontent.com)
  ternyata SUDAH ADA di akun ini, sisa dari setup lama yang lolos dari
  audit kita sebelumnya (IAM OIDC Provider belum pernah masuk
  01-audit-account.sh). Ganti kode GitHubOidcStack untuk IMPORT
  provider yang sudah ada (fromOpenIdConnectProviderArn), bukan create
  baru -- AWS cuma izinkan 1 provider per URL unik per akun.
- 01-audit-account.sh ditambah section IAM OIDC Providers supaya gap
  serupa tidak lolos lagi ke depan.

## v22 - 2026-06-30
- FIX: em-dash lagi (sama persis bug data-stack.ts dulu) di
  GitHubDeployRole description -- IAM Role description punya batasan
  ASCII yang sama dengan EC2 SecurityGroup description. Diganti ke
  tanda hubung biasa.
- Scan ulang SEMUA file untuk em-dash di string literal: ketemu 2 lagi
  (lambda/shared/businessValidation.ts pesan validasi, lambda/
  ai-engine-adapter Error message) -- keduanya AMAN karena tidak pernah
  jadi property resource AWS (satu tersimpan sebagai teks di database,
  satu jadi pesan Error JS biasa), jadi tidak diubah.

## v23 - 2026-06-30
- Tambah SeedDataFn (lambda/seed-data) di Auth Stack -- Lambda
  sekali-pakai untuk membuat tenant pertama + admin user Cognito.
  Pola sama dengan ApplySchemaFn: manual invoke sekali, BUKAN custom
  resource (supaya tidak re-run/duplikat tiap deploy).
- AuthStack sekarang terima vpc, dbSecurityGroup, dbSecretArn (cross-
  stack dependency baru ke DataStack) -- dibutuhkan SeedDataFn untuk
  insert row tenant ke RDS.
- Cara pakai setelah deploy NexTrade-Auth:
    aws lambda invoke --function-name nextrade-seed-data --region ap-southeast-3 \
      --payload '{"tenantName":"PT Ungaran Sari Garments","tenantCode":"USG","adminEmail":"admin@ungaransari.test"}' \
      --cli-binary-format raw-in-base64-out /tmp/seed-out.json
    cat /tmp/seed-out.json
  SIMPAN temporaryPassword dari output -- tidak bisa diambil ulang.

## v24 - 2026-06-30
- Tambah authFlows.adminUserPassword: true di UserPoolClient -- supaya
  bisa test login lewat `aws cognito-idp admin-initiate-auth` tanpa
  perlu implementasi SRP client-side. Frontend tetap pakai userSrp
  (lebih aman). Murni untuk kemudahan testing/ops.

## v25 - 2026-06-30 (FIX KRITIS - API tidak bisa baca DB credentials)
- FIX: api/src/db/pool.ts cari env var DB_SECRET_ARN, padahal Compute
  Stack (ECS) inject ISI secret langsung sebagai DB_CREDENTIALS lewat
  ecs.Secret.fromSecretsManager -- dua pola berbeda yang tidak pernah
  disatukan. getDbCredentials() sekarang dukung KEDUANYA: pakai
  DB_CREDENTIALS kalau ada (ECS, sudah ter-resolve, hemat 1 API call),
  fallback ke fetch via DB_SECRET_ARN kalau tidak (Lambda).
- Ditemukan lewat test end-to-end pertama: login Cognito sukses, panggil
  GET /dashboard/summary, dapat 500 "DB_SECRET_ARN not set" -- bukti
  lain kenapa testing end-to-end penting, bukan cuma percaya deploy
  sukses.
