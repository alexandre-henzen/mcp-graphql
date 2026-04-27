import type { AuthConfig } from "./types.js";

/**
 * Adds auth query params to endpoint URL when using api-key auth with `in: "query"`.
 * Header and bearer auth are returned unchanged.
 */
export function withQueryAuth(endpoint: string, auth?: AuthConfig): string {
	if (!auth || auth.type !== "api-key" || auth.in !== "query") {
		return endpoint;
	}

	const url = new URL(endpoint);
	url.searchParams.set(auth.name, auth.value);
	return url.toString();
}

interface OAuth2TokenResponse {
	access_token?: string;
	expires_in?: number;
	token_type?: string;
}

interface CachedOAuth2Token {
	accessToken: string;
	expiresAt: number;
}

const oauth2TokenCache = new Map<string, CachedOAuth2Token>();

function oauth2CacheKey(auth: Extract<AuthConfig, { type: "oauth2-client-credentials" }>): string {
	return `${auth.tokenUrl}|${auth.clientId}|${auth.scope ?? ""}`;
}

async function getOAuth2AccessToken(
	auth: Extract<AuthConfig, { type: "oauth2-client-credentials" }>,
	timeout = 30_000,
): Promise<string> {
	const cacheKey = oauth2CacheKey(auth);
	const cached = oauth2TokenCache.get(cacheKey);
	const now = Date.now();

	// Refresh token 30s before expiration to avoid race conditions.
	if (cached && cached.expiresAt - 30_000 > now) {
		return cached.accessToken;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		const body = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: auth.clientId,
			client_secret: auth.clientSecret,
		});
		if (auth.scope) {
			body.set("scope", auth.scope);
		}

		const response = await fetch(auth.tokenUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(
				`OAuth2 token request failed: HTTP ${response.status} ${response.statusText}`,
			);
		}

		const payload = (await response.json()) as OAuth2TokenResponse;
		if (!payload.access_token) {
			throw new Error("OAuth2 token response missing access_token");
		}

		const ttlMs = (payload.expires_in ?? 3600) * 1000;
		oauth2TokenCache.set(cacheKey, {
			accessToken: payload.access_token,
			expiresAt: now + ttlMs,
		});

		return payload.access_token;
	} finally {
		clearTimeout(timer);
	}
}

export async function resolveAuthEndpointAndHeaders(
	endpoint: string,
	auth?: AuthConfig,
	timeout = 30_000,
): Promise<{ endpoint: string; headers: Record<string, string> }> {
	if (!auth) return { endpoint, headers: {} };

	switch (auth.type) {
		case "bearer":
			return {
				endpoint,
				headers: { Authorization: `Bearer ${auth.token}` },
			};
		case "api-key":
			if (auth.in === "header") {
				return {
					endpoint,
					headers: { [auth.name]: auth.value },
				};
			}
			return {
				endpoint: withQueryAuth(endpoint, auth),
				headers: {},
			};
		case "oauth2-client-credentials": {
			const accessToken = await getOAuth2AccessToken(auth, timeout);
			return {
				endpoint,
				headers: { Authorization: `Bearer ${accessToken}` },
			};
		}
	}
}
