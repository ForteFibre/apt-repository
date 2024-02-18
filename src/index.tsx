import { Hono } from "hono";
import { GitHubUser, githubAuth } from "@hono/oauth-providers/github";
import { basicAuth } from "./basic";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { SimpleKey } from "./simple-key";
import { verifyBelongingOrganization } from "./github";
import { Credentials, Top } from "./html";

interface Env {
  APT_ACCESS_KEY: string;
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  REPO: R2Bucket;
  [key: string]: unknown;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/auth",
  (c, next) => {
    const middleware = githubAuth({
      client_id: c.env.GH_CLIENT_ID,
      client_secret: c.env.GH_CLIENT_SECRET,
      oauthApp: true,
      scope: ["read:org"],
    });

    return middleware(c, next);
  },
  async (c) => {
    const token = c.get("token")?.token;
    if (!token) {
      return c.text("Unauthorized", { status: 401 });
    }

    // TODO: ハードコーディングしない
    const isMember = await verifyBelongingOrganization(token, "ForteFibre");

    if (isMember) {
      const user: GitHubUser = c.get("user-github") as GitHubUser;
      const id = `${user.login}-${user.id}-${Date.now()}`;

      await setSignedCookie(c, "apt_session", id, c.env.APT_ACCESS_KEY, {
        maxAge: 60 * 60 * 24,
      });

      return c.redirect("/credentials");
    }

    return c.text("Unauthorized", { status: 401 });
  }
);

app.get("/credentials", async (c) => {
  const session = await getSignedCookie(c, c.env.APT_ACCESS_KEY, "apt_session");
  if (!session) {
    return c.redirect("/auth");
  }

  const username = session;
  const password = await new SimpleKey(c.env.APT_ACCESS_KEY).generatePassword(
    username
  );

  return c.html(<Credentials username={username} password={password} />);
});

app.get("/", (c) => {
  return c.html(<Top />);
});

app.get("*", async (c) => {
  const shouldAuth =
    !c.req.path.endsWith(".asc") && !c.req.path.endsWith(".yaml");
  if (shouldAuth) {
    const credentials = basicAuth(c.req);

    if (!credentials) {
      const res = new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="ForteFibre"',
        },
      });
      return res;
    }

    const { username, password } = credentials;
    const shaSecret = c.env.APT_ACCESS_KEY;
    const simpleKey = new SimpleKey(shaSecret);
    const expectedPassword = await simpleKey.generatePassword(username);

    if (expectedPassword !== password) {
      const res = new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="ForteFibre"',
        },
      });
      return res;
    }
  }

  const object = await c.env.REPO.get(c.req.path.slice(1));

  if (object === null) {
    return new Response("Object Not Found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  return new Response(object.body, {
    headers,
  });
});

export default app;
