import { Hono, HonoRequest } from "hono";
import { decodeBase64, encodeBase64Url } from "hono/utils/encode";

interface Env {
  APT_ACCESS_KEY: string;
  REPO: R2Bucket;
  [key: string]: unknown;
}

const app = new Hono<{ Bindings: Env }>();

const CREDENTIALS_REGEXP =
  /^ *(?:[Bb][Aa][Ss][Ii][Cc]) +([A-Za-z0-9._~+/-]+=*) *$/;
const USER_PASS_REGEXP = /^([^:]*):(.*)$/;
const utf8Decoder = new TextDecoder();
const auth = (req: HonoRequest) => {
  const match = CREDENTIALS_REGEXP.exec(req.header("Authorization") || "");
  if (!match) {
    return undefined;
  }

  let userPass = undefined;
  // If an invalid string is passed to atob(), it throws a `DOMException`.
  try {
    userPass = USER_PASS_REGEXP.exec(
      utf8Decoder.decode(decodeBase64(match[1]))
    );
  } catch {} // Do nothing

  if (!userPass) {
    return undefined;
  }

  return { username: userPass[1], password: userPass[2] };
};

app.get("*", async (c) => {
  const credentials = auth(c.req);
  const shaSecret = c.env.APT_ACCESS_KEY;
  if (!credentials) {
    const res = new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="ForteFibre"',
      },
    });
    return res;
  }

  const shaKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(shaSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const shaHash = await crypto.subtle.sign(
    "HMAC",
    shaKey,
    new TextEncoder().encode(credentials.username)
  );

  const expectedPassword = [...new Uint8Array(shaHash)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

  if (expectedPassword !== credentials.password) {
    const res = new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="ForteFibre"',
      },
    });
    return res;
  }

  return c.text("Hello Hono!");
});

export default app;
