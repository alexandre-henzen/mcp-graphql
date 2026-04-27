import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveAuthEndpointAndHeaders,
	withQueryAuth,
} from "../src/config/auth.js";

describe("withQueryAuth", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("returns endpoint unchanged when auth is undefined", () => {
		expect(withQueryAuth("https://example.com/graphql")).toBe(
			"https://example.com/graphql",
		);
	});

	it("returns endpoint unchanged for bearer auth", () => {
		expect(
			withQueryAuth("https://example.com/graphql", {
				type: "bearer",
				token: "abc",
			}),
		).toBe("https://example.com/graphql");
	});

	it("appends API key as query parameter when auth.in is query", () => {
		expect(
			withQueryAuth("https://example.com/graphql", {
				type: "api-key",
				name: "api_key",
				value: "secret",
				in: "query",
			}),
		).toBe("https://example.com/graphql?api_key=secret");
	});

	it("preserves existing query parameters", () => {
		expect(
			withQueryAuth("https://example.com/graphql?version=1", {
				type: "api-key",
				name: "api_key",
				value: "secret",
				in: "query",
			}),
		).toBe("https://example.com/graphql?version=1&api_key=secret");
	});

	it("resolves bearer auth into Authorization header", async () => {
		const result = await resolveAuthEndpointAndHeaders(
			"https://example.com/graphql",
			{ type: "bearer", token: "abc" },
		);
		expect(result).toEqual({
			endpoint: "https://example.com/graphql",
			headers: { Authorization: "Bearer abc" },
		});
	});

	it("requests OAuth2 token for client-credentials auth", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					access_token: "oauth-token",
					expires_in: 3600,
				}),
			}),
		);

		const result = await resolveAuthEndpointAndHeaders(
			"https://example.com/graphql",
			{
				type: "oauth2-client-credentials",
				tokenUrl: "https://auth.example.com/token",
				clientId: "id",
				clientSecret: "secret",
				scope: "read:graphql",
			},
		);

		expect(result).toEqual({
			endpoint: "https://example.com/graphql",
			headers: { Authorization: "Bearer oauth-token" },
		});
		expect(fetch).toHaveBeenCalledWith(
			"https://auth.example.com/token",
			expect.objectContaining({
				method: "POST",
			}),
		);
	});
});
