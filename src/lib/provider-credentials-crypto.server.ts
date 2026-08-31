import "@tanstack/react-start/server-only";

export class ProviderCredentialsCryptoError extends Error {
  constructor(readonly code: "PROVIDER_CREDENTIALS_MASTER_KEY_MISSING" | "PROVIDER_CREDENTIALS_MASTER_KEY_INVALID" | "PROVIDER_CREDENTIAL_DECRYPTION_FAILED") {
    super("供应商凭证无法安全处理。");
    this.name = "ProviderCredentialsCryptoError";
  }
}

export type EncryptedProviderSecret = { ciphertext: string; iv: string; encryptionVersion: 1 };

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string, invalidCode: ProviderCredentialsCryptoError["code"]) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new ProviderCredentialsCryptoError(invalidCode);
  }
}

function additionalData(provider: string) {
  return new TextEncoder().encode(`mumo:provider-credential:v1:${provider}`);
}

async function importMasterKey(masterKey: string) {
  if (!masterKey.trim()) throw new ProviderCredentialsCryptoError("PROVIDER_CREDENTIALS_MASTER_KEY_MISSING");
  const bytes = decodeBase64(masterKey, "PROVIDER_CREDENTIALS_MASTER_KEY_INVALID");
  if (bytes.byteLength !== 32) throw new ProviderCredentialsCryptoError("PROVIDER_CREDENTIALS_MASTER_KEY_INVALID");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptProviderSecret(masterKey: string, provider: string, secret: string): Promise<EncryptedProviderSecret> {
  if (!secret) throw new ProviderCredentialsCryptoError("PROVIDER_CREDENTIALS_MASTER_KEY_INVALID");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importMasterKey(masterKey);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(provider), tagLength: 128 }, key, new TextEncoder().encode(secret));
  return { ciphertext: encodeBase64(new Uint8Array(ciphertext)), iv: encodeBase64(iv), encryptionVersion: 1 };
}

export async function decryptProviderSecret(masterKey: string, provider: string, encrypted: EncryptedProviderSecret): Promise<string> {
  try {
    const key = await importMasterKey(masterKey);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(encrypted.iv, "PROVIDER_CREDENTIAL_DECRYPTION_FAILED"), additionalData: additionalData(provider), tagLength: 128 }, key, decodeBase64(encrypted.ciphertext, "PROVIDER_CREDENTIAL_DECRYPTION_FAILED"));
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof ProviderCredentialsCryptoError) throw error;
    throw new ProviderCredentialsCryptoError("PROVIDER_CREDENTIAL_DECRYPTION_FAILED");
  }
}
