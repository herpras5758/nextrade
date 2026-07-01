import axios from "axios";
import { ENV } from "./env";

export const apiClient = axios.create({ baseURL: `${ENV.apiUrl}/api/v1` });

let getToken: (() => string | null) | null = null;

export function setAuthTokenGetter(fn: () => string | null) {
  getToken = fn;
}

apiClient.interceptors.request.use((config) => {
  const token = getToken?.();
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
