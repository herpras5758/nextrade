import axios from "axios";
import { ENV } from "./env";

export const apiClient = axios.create({ baseURL: `${ENV.apiUrl}/api/v1` });

let getToken: (() => string | null) | null = null;

export function setAuthTokenGetter(fn: () => string | null) {
  getToken = fn;
}

// Fallback: read Cognito token directly from localStorage if getter not set yet
function readCognitoToken(): string | null {
  try {
    const poolId = ENV.cognitoUserPoolId;
    const clientId = ENV.cognitoClientId;
    // Cognito stores tokens as CognitoIdentityServiceProvider.{clientId}.{username}.idToken
    const lastUserKey = `CognitoIdentityServiceProvider.${clientId}.LastAuthUser`;
    const username = localStorage.getItem(lastUserKey);
    if (!username) return null;
    const tokenKey = `CognitoIdentityServiceProvider.${clientId}.${username}.idToken`;
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

apiClient.interceptors.request.use((config) => {
  // Try registered getter first, fall back to direct localStorage read
  const token = getToken?.() ?? readCognitoToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);
