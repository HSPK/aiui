import { bench, describe } from "vitest";
import { constantTimeEqual, decryptSecret, encryptSecret, sha256 } from "@/lib/server/crypto";

// Every gateway request decrypts the provider API key before it can build
// the upstream call, so this sits directly in the per-request path.

const PLAINTEXT = "sk-proj-0123456789abcdefghijklmnopqrstuvwxyz0123456789";
const SEALED = encryptSecret(PLAINTEXT)!;

describe("crypto", () => {
    bench("encryptSecret (provider key)", () => {
        encryptSecret(PLAINTEXT);
    });

    bench("decryptSecret (per gateway request)", () => {
        decryptSecret(SEALED);
    });

    bench("sha256 (api-key lookup hash)", () => {
        sha256(PLAINTEXT);
    });

    bench("constantTimeEqual", () => {
        constantTimeEqual(PLAINTEXT, PLAINTEXT);
    });
});
