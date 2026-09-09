import { Context, Hono } from "hono";
import { GitHubUser, githubAuth } from "@hono/oauth-providers/github";
import { basicAuth } from "./basic";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { SimpleKey } from "./simple-key";
import { verifyBelongingOrganization } from "./github";
import { Credentials, Top } from "./html";
import { createRosdepYaml } from "./auto-rosdep";
import { installScript } from "./install-script";
import { bearerToken, verifyActionsToken } from "./oidc";

interface Env extends Cloudflare.Env {
  // secret として設定されるため wrangler.jsonc には載らず、型生成の対象外
  APT_ACCESS_KEY: string;
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  [key: string]: unknown;
}

// GitHub の OIDC トークン自体は 15 分で失効するが、ジョブはそれより長く走るので
// 交換後の資格情報にはもう少し余裕を持たせる
const OIDC_CREDENTIALS_TTL_SECONDS = 60 * 60;

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/auth",
  (c, next) => {
    const middleware = githubAuth({
      client_id: c.env.GH_CLIENT_ID,
      client_secret: c.env.GH_CLIENT_SECRET,
      oauthApp: true,
      // user:email は @hono/oauth-providers が /user/emails を無条件に叩くために必要
      scope: ["read:org", "user:email"],
    });

    return middleware(c, next);
  },
  async (c) => {
    const token = c.get("token")?.token;
    if (!token) {
      return c.text("Unauthorized", { status: 401 });
    }

    const isMember = await verifyBelongingOrganization(
      token,
      c.env.GH_ORG_LOGIN
    );

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

/**
 * GitHub Actions の OIDC トークンを、有効期限つきの apt 用資格情報に交換する。
 * 検証に失敗した場合はそのまま返せる Response を返す。
 */
const exchangeOidcToken = async (c: Context<{ Bindings: Env }>) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) {
    return {
      ok: false as const,
      response: c.text(
        "Send the GitHub Actions OIDC token as `Authorization: Bearer <token>`.\n",
        401
      ),
    };
  }

  const verified = await verifyActionsToken(token, {
    audience: c.env.OIDC_AUDIENCE,
    organizationId: c.env.GH_ORG_ID,
    allowedRepositories: c.env.OIDC_ALLOWED_REPOS,
  });

  if (!verified.ok) {
    return {
      ok: false as const,
      response: c.text(`${verified.message}\n`, verified.status),
    };
  }

  const credentials = await new SimpleKey(
    c.env.APT_ACCESS_KEY
  ).issueForRepository(
    verified.claims.repository,
    OIDC_CREDENTIALS_TTL_SECONDS
  );

  return { ok: true as const, credentials };
};

app.get("/oidc/credentials", async (c) => {
  const exchange = await exchangeOidcToken(c);
  if (!exchange.ok) {
    return exchange.response;
  }

  return c.json(
    {
      username: exchange.credentials.username,
      password: exchange.credentials.password,
      expires_at: exchange.credentials.expiresAt,
    },
    200,
    { "Cache-Control": "no-store" }
  );
});

app.get("/oidc/install.bash", async (c) => {
  const exchange = await exchangeOidcToken(c);
  if (!exchange.ok) {
    return exchange.response;
  }

  return c.text(
    installScript(exchange.credentials.username, exchange.credentials.password),
    200,
    { "Cache-Control": "no-store" }
  );
});

app.get("/rosdep/:codename/:rosdistro/rosdep.yaml", async (c) => {
  const packagesResponse = await c.env.REPO.get(
    `dists/${c.req.param("codename")}/main/binary-amd64/Packages`
  );
  if (packagesResponse === null) {
    return c.text("Not Found", { status: 404 });
  }
  const packagesContent = await packagesResponse?.text();
  const rosdepYaml = createRosdepYaml(
    packagesContent,
    c.req.param("rosdistro")
  );
  return c.text(rosdepYaml);
});

app.get("/install.bash", async (c) => {
  const username = c.req.query("username");
  const password = c.req.query("password");

  if (!username || !password) {
    return c.text("Unauthorized", { status: 401 });
  }

  return c.text(installScript(username, password));
});

app.get("*", async (c) => {
  const shouldAuth =
    !c.req.path.endsWith(".asc") && !c.req.path.endsWith(".yaml");
  if (shouldAuth) {
    const credentials = basicAuth(c.req);

    if (!credentials) {
      return unauthorized();
    }

    const { username, password } = credentials;
    const simpleKey = new SimpleKey(c.env.APT_ACCESS_KEY);

    if (!(await simpleKey.verify(username, password))) {
      return unauthorized();
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

const unauthorized = () =>
  new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ForteFibre"',
    },
  });

export default app;
