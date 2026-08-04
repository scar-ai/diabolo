import { generateKeyPairSync } from "node:crypto";

const encodeSshField = (value: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
};

const decodeBase64Url = (value: string) =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const encodeSshMpint = (value: Buffer) => {
  const normalized =
    value[0] && (value[0] & 0x80) !== 0 ? Buffer.concat([Buffer.from([0]), value]) : value;
  return encodeSshField(normalized);
};

export const normalizeSshPublicKey = (value: string | null | undefined) => {
  const normalized = value?.trim() ?? "";
  return normalized || null;
};

export const normalizeSshPrivateKey = (value: string | null | undefined) => {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  if (!normalized.includes("-----BEGIN") || !normalized.includes("PRIVATE KEY-----")) {
    throw new Error("Enter a PEM or OpenSSH private key.");
  }

  return `${normalized}\n`;
};

export const generateProjectSshKeyPair = async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
  });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
  const publicKeyJwk = publicKey.export({ format: "jwk" });

  if (publicKeyJwk.kty !== "RSA" || !publicKeyJwk.e || !publicKeyJwk.n) {
    throw new Error("Failed to generate an SSH key pair.");
  }

  const algorithm = Buffer.from("ssh-rsa");
  const publicKeyBlob = Buffer.concat([
    encodeSshField(algorithm),
    encodeSshMpint(decodeBase64Url(publicKeyJwk.e)),
    encodeSshMpint(decodeBase64Url(publicKeyJwk.n)),
  ]);

  return {
    privateKey: privateKeyPem,
    publicKey: `ssh-rsa ${publicKeyBlob.toString("base64")} diabolo-project`,
  };
};
