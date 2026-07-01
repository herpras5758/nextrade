// Reads Vite env vars set in .env.production at deploy time. These map
// 1:1 to the AuthStack/ComputeStack CfnOutputs (UserPoolId,
// UserPoolClientId, ApiUrl) — see DEPLOY.md step 3.
export const ENV = {
  apiUrl: import.meta.env.VITE_API_URL as string,
  cognitoUserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  cognitoClientId: import.meta.env.VITE_COGNITO_CLIENT_ID as string,
};

if (!ENV.apiUrl || !ENV.cognitoUserPoolId || !ENV.cognitoClientId) {
  // Fails loudly at build/runtime rather than silently hitting undefined
  // endpoints — this exact class of bug (env var name mismatch) already
  // cost real debugging time once in this project (DB_CREDENTIALS vs
  // DB_SECRET_ARN), so the frontend equivalent should not repeat it.
  console.error("Missing required VITE_ env vars. Check .env.production against DEPLOY.md step 3.");
}
