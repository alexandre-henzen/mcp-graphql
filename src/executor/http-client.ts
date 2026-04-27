import type { AuthConfig } from "../config/types.js";
import { resolveAuthEndpointAndHeaders } from "../config/auth.js";
import { logger } from "../utils/logger.js";

export interface GraphqlRequest {
	query: string;
	variables: Record<string, unknown>;
}

export interface GraphqlResponse {
	data?: unknown;
	errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

export interface HttpClientOptions {
	endpoint: string;
	headers?: Record<string, string>;
	authHeaders?: Record<string, string>;
	auth?: AuthConfig;
	timeout?: number;
	maxRetries?: number;
}

export async function executeGraphql(
	request: GraphqlRequest,
	options: HttpClientOptions,
): Promise<GraphqlResponse> {
	const { timeout = 30_000, maxRetries = 3 } = options;
	const authResolved = await resolveAuthEndpointAndHeaders(
		options.endpoint,
		options.auth,
		timeout,
	);
	const endpoint = authResolved.endpoint;
	const headers = buildHeaders({
		...options,
		endpoint,
		authHeaders: authResolved.headers,
	});

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (attempt > 0) {
			const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
			logger.warn(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
			await sleep(delay);
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(request),
				signal: controller.signal,
			});

			clearTimeout(timer);

			// Retry on 429 or 5xx
			if (response.status === 429 || response.status >= 500) {
				lastError = new Error(
					`HTTP ${response.status} ${response.statusText}`,
				);
				if (attempt < maxRetries) continue;
				throw lastError;
			}

			if (!response.ok) {
				throw new Error(
					`GraphQL request failed: HTTP ${response.status} ${response.statusText}`,
				);
			}

			const json = (await response.json()) as GraphqlResponse;
			return json;
		} catch (err) {
			clearTimeout(timer);
			if (err instanceof DOMException && err.name === "AbortError") {
				lastError = new Error(`Request timed out after ${timeout}ms`);
			} else if (err instanceof Error) {
				lastError = err;
			} else {
				lastError = new Error(String(err));
			}

			if (attempt >= maxRetries) throw lastError;
		}
	}

	throw lastError ?? new Error("Request failed");
}

function buildHeaders(options: HttpClientOptions): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...options.headers,
		...options.authHeaders,
	};

	return headers;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
