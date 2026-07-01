import Fastify from "fastify";
import cors from "@fastify/cors";
import { verifyAuth } from "./middleware/auth.js";
import { shipmentRoutes } from "./routes/shipments.js";
import { documentRoutes } from "./routes/documents.js";
import { reviewRoutes } from "./routes/review.js";
import { emailIntakeRoutes } from "./routes/emailIntake.js";
import { uploadSessionRoutes } from "./routes/uploadSession.js";
import { adminConfigRoutes } from "./routes/admin/config.js";
import { ceisaSubmitRoutes } from "./routes/ceisaSubmit.js";
import { ceisaReadinessRoutes } from "./routes/ceisaReadiness.js";
import { aiChatRoutes } from "./routes/aiChat.js";
import { reportRoutes } from "./routes/reports.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true, // tighten to the CloudFront domain once frontend is deployed
});

// Health check — no auth, used by the ALB target group (Compute Stack
// configures the health check path to exactly this route).
app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

// Every route below this point requires a verified Cognito JWT.
app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  await verifyAuth(request, reply);
});

await app.register(shipmentRoutes, { prefix: "/api/v1" });
await app.register(documentRoutes, { prefix: "/api/v1" });
await app.register(reviewRoutes, { prefix: "/api/v1" });
await app.register(emailIntakeRoutes, { prefix: "/api/v1" });
await app.register(uploadSessionRoutes, { prefix: "/api/v1" });
await app.register(adminConfigRoutes, { prefix: "/api/v1" });
await app.register(ceisaSubmitRoutes, { prefix: "/api/v1" });
await app.register(ceisaReadinessRoutes, { prefix: "/api/v1" });
await app.register(aiChatRoutes, { prefix: "/api/v1" });
await app.register(reportRoutes, { prefix: "/api/v1" });

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
