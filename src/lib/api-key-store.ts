import { API_KEY_STORAGE } from "@/lib/pipeline-types";

export function readStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string): void {
  const trimmed = key.trim();
  window.localStorage.setItem(API_KEY_STORAGE, trimmed);
}

export function deleteApiKey(): void {
  window.localStorage.removeItem(API_KEY_STORAGE);
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••";
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function isPlausibleApiKey(key: string): boolean {
  const trimmed = key.trim();
  return trimmed.length >= 20 && !/\s/.test(trimmed);
}
