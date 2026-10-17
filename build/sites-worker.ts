import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

type AccessContext = ExecutionContext<{ CONNECTORS?: ConnectorBinding }> & {
  access?: {
    aud: string | string[];
    getIdentity(): Promise<{ email?: string }>;
  };
};

type WorkerEnv = Cloudflare.Env & { CLOUDFLARE_ACCESS_AUD?: string };

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: AccessContext) {
    // Independent Cloudflare deployments opt in; Sites keeps its own gateway.
    if (env.CLOUDFLARE_ACCESS_AUD) {
      const access = ctx.access;
      const audiences = access
        ? (Array.isArray(access.aud) ? access.aud : [access.aud])
        : [];
      if (!access || !audiences.includes(env.CLOUDFLARE_ACCESS_AUD)) {
        return new Response("Access authentication required", { status: 403 });
      }
      const identity = await access.getIdentity();
      if (!identity.email) {
        return new Response("Access email required", { status: 403 });
      }
      const url = new URL(request.url);
      if (url.pathname === "/signin-with-chatgpt" || url.pathname === "/callback") {
        return Response.redirect(new URL("/", url).href, 302);
      }
      if (url.pathname === "/signout-with-chatgpt") {
        return Response.redirect(new URL("/cdn-cgi/access/logout", url).href, 302);
      }
      // Never trust identity headers supplied by a browser or other client.
      const headers = new Headers(request.headers);
      for (const name of Array.from(headers.keys())) {
        if (name.startsWith("oai-authenticated-user-")) headers.delete(name);
      }
      const email = identity.email.trim().toLowerCase();
      if (!email) return new Response("Access email required", { status: 403 });
      headers.set("oai-authenticated-user-id", "cloudflare:" + email);
      headers.set("oai-authenticated-user-email", email);
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
