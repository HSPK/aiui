import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { buildConfigTemplate, generateMasterKey } from "@/lib/cli/init/template";
import type { ProviderEntry } from "@/lib/cli/init/types";

describe("lib/cli/init/template: generateMasterKey", () => {
    it("returns a 64-char lowercase hex string (32 random bytes)", () => {
        const key = generateMasterKey();
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns a different key on every call", () => {
        expect(generateMasterKey()).not.toBe(generateMasterKey());
    });
});

describe("lib/cli/init/template: buildConfigTemplate", () => {
    const masterKey = "a".repeat(64);

    function parse(opts: Parameters<typeof buildConfigTemplate>[0]) {
        const yaml = buildConfigTemplate(opts);
        return { yaml, parsed: parseYaml(yaml) as Record<string, unknown> };
    }

    it("produces parseable YAML with the master key set verbatim", () => {
        const { parsed } = parse({ masterKey });
        expect(parsed.master_key).toBe(masterKey);
    });

    it("defaults admin.username to 'admin' and admin.password to the ${LOOM_ADMIN_PASSWORD} reference", () => {
        const { yaml, parsed } = parse({ masterKey });
        const admin = parsed.admin as { username: string; password: string };
        expect(admin.username).toBe("admin");
        expect(admin.password).toBe("${LOOM_ADMIN_PASSWORD}");
        // The ${...} interpolation form must be quoted in the raw YAML
        // source (braces aren't in the "plain scalar" allow-list) —
        // otherwise it'd be ambiguous/invalid YAML flow-scalar syntax.
        expect(yaml).toContain('password: "${LOOM_ADMIN_PASSWORD}"');
    });

    it("honors a custom admin username", () => {
        const { parsed } = parse({ masterKey, adminUsername: "alice" });
        expect((parsed.admin as { username: string }).username).toBe("alice");
    });

    it("honors a literal (non-${}) admin password and still emits valid YAML", () => {
        const { parsed } = parse({ masterKey, adminPasswordRef: "hunter2!" });
        expect((parsed.admin as { password: string }).password).toBe("hunter2!");
    });

    it("omits the server block (fully commented) when port and hostname are both absent", () => {
        const { yaml, parsed } = parse({ masterKey });
        expect(parsed.server).toBeUndefined();
        expect(yaml).toContain("# server:");
        expect(yaml).toContain("#   port: 3000");
        expect(yaml).toContain("#   hostname: 0.0.0.0");
    });

    it("emits an active server block with just `port` when only port is given", () => {
        const { yaml, parsed } = parse({ masterKey, port: 4000 });
        expect(parsed.server).toEqual({ port: 4000 });
        expect(yaml).toContain("server:\n  port: 4000\n");
    });

    it("treats port 0 as present (uses `!= null`, not truthiness)", () => {
        const { parsed } = parse({ masterKey, port: 0 });
        expect(parsed.server).toEqual({ port: 0 });
    });

    it("emits an active server block with just `hostname` when only hostname is given", () => {
        const { yaml, parsed } = parse({ masterKey, hostname: "127.0.0.1" });
        expect(parsed.server).toEqual({ hostname: "127.0.0.1" });
        expect(yaml).not.toContain("  port:");
    });

    it("emits both port and hostname when both are given", () => {
        const { parsed } = parse({ masterKey, port: 8080, hostname: "0.0.0.0" });
        expect(parsed.server).toEqual({ port: 8080, hostname: "0.0.0.0" });
    });

    it("has no `providers` key when providers is omitted (fully commented placeholder)", () => {
        const { yaml, parsed } = parse({ masterKey });
        expect(parsed.providers).toBeUndefined();
        expect(yaml).toContain("# providers:");
        expect(yaml).toContain("#     api_key: ${OPENAI_API_KEY}");
    });

    it("has no `providers` key when providers is an empty array", () => {
        const { parsed } = parse({ masterKey, providers: [] });
        expect(parsed.providers).toBeUndefined();
    });

    it("renders an openai provider block", () => {
        const providers: ProviderEntry[] = [{ kind: "openai", apiKeyRef: "${OPENAI_API_KEY}" }];
        const { parsed } = parse({ masterKey, providers });
        expect(parsed.providers).toEqual([
            {
                name: "openai",
                base_url: "https://api.openai.com/v1",
                api_key: "${OPENAI_API_KEY}",
                document_page: "https://platform.openai.com/docs",
            },
        ]);
    });

    it("renders an azure-openai provider block with adapter_id and api_version", () => {
        const providers: ProviderEntry[] = [
            {
                kind: "azure-openai",
                baseUrl: "https://my-resource.openai.azure.com",
                apiVersion: "2024-10-21",
                apiKeyRef: "${AZURE_OPENAI_API_KEY}",
            },
        ];
        const { parsed } = parse({ masterKey, providers });
        expect(parsed.providers).toEqual([
            {
                name: "azure-openai",
                adapter_id: "azure-openai",
                base_url: "https://my-resource.openai.azure.com",
                api_version: "2024-10-21",
                api_key: "${AZURE_OPENAI_API_KEY}",
            },
        ]);
    });

    it("renders an azure-foundry provider block with adapter_id (no api_version)", () => {
        const providers: ProviderEntry[] = [
            {
                kind: "azure-foundry",
                baseUrl: "https://my-foundry.services.ai.azure.com",
                apiKeyRef: "${AZURE_FOUNDRY_API_KEY}",
            },
        ];
        const { parsed } = parse({ masterKey, providers });
        expect(parsed.providers).toEqual([
            {
                name: "foundry",
                adapter_id: "azure-foundry",
                base_url: "https://my-foundry.services.ai.azure.com",
                api_key: "${AZURE_FOUNDRY_API_KEY}",
            },
        ]);
    });

    it("renders multiple providers in order, each separated cleanly", () => {
        const providers: ProviderEntry[] = [
            { kind: "openai", apiKeyRef: "${OPENAI_API_KEY}" },
            {
                kind: "azure-openai",
                baseUrl: "https://x.openai.azure.com",
                apiVersion: "2024-10-21",
                apiKeyRef: "${AZURE_OPENAI_API_KEY}",
            },
        ];
        const { parsed } = parse({ masterKey, providers });
        expect(Array.isArray(parsed.providers)).toBe(true);
        expect((parsed.providers as unknown[]).length).toBe(2);
        expect((parsed.providers as Array<{ name: string }>)[0].name).toBe("openai");
        expect((parsed.providers as Array<{ name: string }>)[1].name).toBe("azure-openai");
    });

    it("quotes a literal (inline, non-env) API key that contains YAML-unsafe characters", () => {
        const providers: ProviderEntry[] = [{ kind: "openai", apiKeyRef: "sk-ABC123+def=" }];
        const { yaml, parsed } = parse({ masterKey, providers });
        expect(yaml).toContain('api_key: "sk-ABC123+def="');
        expect((parsed.providers as Array<{ api_key: string }>)[0].api_key).toBe("sk-ABC123+def=");
    });

    it("leaves a plain-identifier API key unquoted in the raw YAML", () => {
        const providers: ProviderEntry[] = [{ kind: "openai", apiKeyRef: "sk-plain-key-123" }];
        const { yaml } = parse({ masterKey, providers });
        expect(yaml).toContain("api_key: sk-plain-key-123\n");
        expect(yaml).not.toContain('"sk-plain-key-123"');
    });
});

describe("lib/cli/init/template: quoteYamlScalar (via buildConfigTemplate's admin.password)", () => {
    const masterKey = "b".repeat(64);

    function passwordLine(pw: string): string {
        return buildConfigTemplate({ masterKey, adminPasswordRef: pw })
            .split("\n")
            .find((l) => l.startsWith("  password:"))!;
    }

    it("leaves a plain identifier-like scalar unquoted", () => {
        expect(passwordLine("plain-value_123.ok:also/fine")).toBe(
            "  password: plain-value_123.ok:also/fine",
        );
    });

    it("double-quotes (and escapes) a value containing double quotes", () => {
        const line = passwordLine('say "hi"');
        expect(line).toBe(`  password: ${JSON.stringify('say "hi"')}`);
        const parsed = parseYaml(buildConfigTemplate({ masterKey, adminPasswordRef: 'say "hi"' }));
        expect((parsed as { admin: { password: string } }).admin.password).toBe('say "hi"');
    });

    it("quotes a value containing a colon-space (YAML mapping ambiguity)", () => {
        const line = passwordLine("foo: bar");
        expect(line).toBe(`  password: ${JSON.stringify("foo: bar")}`);
    });

    it("leaves a bare colon (no following space, e.g. a URL with a port) unquoted", () => {
        const line = passwordLine("https://host:8080");
        expect(line).toBe("  password: https://host:8080");
    });

    it("quotes the ${...} interpolation form", () => {
        const line = passwordLine("${SOME_VAR}");
        expect(line).toBe('  password: "${SOME_VAR}"');
    });

    it("quotes an empty string as an empty YAML scalar", () => {
        const line = passwordLine("");
        expect(line).toBe('  password: ""');
        const parsed = parseYaml(buildConfigTemplate({ masterKey, adminPasswordRef: "" }));
        expect((parsed as { admin: { password: string } }).admin.password).toBe("");
    });

    it("quotes a value containing a literal space", () => {
        const line = passwordLine("has space");
        expect(line).toBe(`  password: ${JSON.stringify("has space")}`);
    });
});
