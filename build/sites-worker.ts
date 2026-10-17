import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

type WorkerEnv = Cloudflare.Env & {
  CLOUDFLARE_ACCESS_AUD?: string;
  CLOUDFLARE_ACCESS_ISSUER?: string;
};

let accessIssuer: string | undefined;
let accessKeys: ReturnType<typeof createRemoteJWKSet> | undefined;

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // Static Assets routing does not propagate ctx.access. Verify the signed JWT.
    // Sites deployments leave these variables unset and keep their own gateway.
    if (env.CLOUDFLARE_ACCESS_AUD) {
      const issuer = env.CLOUDFLARE_ACCESS_ISSUER;
      if (!issuer) return new Response("Access issuer is not configured", { status: 503 });
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token) return new Response("Access authentication required", { status: 403 });
      if (!accessKeys || accessIssuer !== issuer) {
        accessKeys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
        accessIssuer = issuer;
      }
      let identity;
      try {
        ({ payload: identity } = await jwtVerify(token, accessKeys, {
          issuer,
          audience: env.CLOUDFLARE_ACCESS_AUD,
          algorithms: ["RS256"],
          requiredClaims: ["sub", "email", "exp"],
        }));
      } catch (error) {
        const invalid = error instanceof errors.JWTExpired
          || error instanceof errors.JWTClaimValidationFailed
          || error instanceof errors.JWTInvalid
          || error instanceof errors.JWSInvalid
          || error instanceof errors.JWSSignatureVerificationFailed
          || error instanceof errors.JOSEAlgNotAllowed
          || error instanceof errors.JWKSNoMatchingKey;
        if (!invalid) console.error("Access verification unavailable", error instanceof Error ? error.name : "UnknownError");
        return new Response(invalid ? "Invalid Access identity" : "Access verification unavailable", { status: invalid ? 403 : 503 });
      }
      if (typeof identity.email !== "string" || typeof identity.sub !== "string"
        || !identity.email.trim() || !identity.sub) {
        return new Response("Access user identity required", { status: 403 });
      }
      const url = new URL(request.url);
      if (url.pathname === "/signin-with-chatgpt" || url.pathname === "/callback") {
        return Response.redirect(new URL("/", url).href, 302);
      }
      if (url.pathname === "/signout-with-chatgpt") {
        return Response.redirect(new URL("/cdn-cgi/access/logout", url).href, 302);
      }
      const headers = new Headers(request.headers);
      for (const name of Array.from(headers.keys())) {
        if (name.startsWith("oai-authenticated-user-")) headers.delete(name);
      }
      headers.set("oai-authenticated-user-id", "cloudflare:" + identity.sub);
      headers.set("oai-authenticated-user-email", identity.email.trim().toLowerCase());
      request = new Request(request, { headers });
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
