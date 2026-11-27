#!/usr/bin/env node
/**
 * Generates vault.json compatible 100% with Web Crypto API in js/crypto-vault.js
 * (AES-256-GCM + PBKDF2-SHA256 600,000 iterations, ct = ciphertext || authTag)
 *
 * Usage (via stdin JSON so secrets never appear in process argv):
 *   echo '{"token":"...","password":"...","owner":"GrenDyui","repo":"quy12a6","hint":""}' | node scripts/setup_vault.mjs
 */

import crypto from "node:crypto";

const VAULT_ITER = 600000;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function encryptVaultNode({ token, owner = "GrenDyui", repo = "quy12a6", hint = "", unlockAdmin = true }, password) {
  if (!token) throw new Error("Missing token");
  if (!password || String(password).length < 8) {
    throw new Error("Vault password must be at least 8 characters");
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, VAULT_ITER, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = JSON.stringify({ token, owner, repo, createdAt: Date.now() });
  const enc1 = cipher.update(payload, "utf8");
  const enc2 = cipher.final();
  const tag = cipher.getAuthTag(); // 16 bytes — Web Crypto appends tag to ciphertext
  const ctWithTag = Buffer.concat([enc1, enc2, tag]);

  return {
    v: 1,
    alg: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iter: VAULT_ITER,
    owner,
    repo,
    unlockAdmin: Boolean(unlockAdmin),
    hint: String(hint || "").slice(0, 80),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    ct: ctWithTag.toString("base64"),
    updatedAt: Date.now()
  };
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const raw = (await readStdin()).trim();
  const input = JSON.parse(raw);
  const vault = encryptVaultNode(input, input.password);
  process.stdout.write(JSON.stringify(vault, null, 2));
}
