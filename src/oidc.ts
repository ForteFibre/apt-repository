import { createRemoteJWKSet, errors, jwtVerify, JWTPayload } from "jose";

const ISSUER = "https://token.actions.githubusercontent.com";

// createRemoteJWKSet 自体は fetch を行わないので、モジュールスコープに置いても
// Workers の global scope I/O 制限には抵触しない。isolate が生きている間、
// 取得済みの JWKS が再利用される。
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export interface ActionsTokenClaims extends JWTPayload {
  repository: string;
  repository_owner: string;
  // 数値に見えるが、GitHub は文字列として発行する
  repository_owner_id: string;
  repository_id?: string;
  ref?: string;
  sha?: string;
  actor?: string;
  workflow?: string;
  run_id?: string;
  event_name?: string;
  job_workflow_ref?: string;
}

export interface OidcConfig {
  audience: string;
  organizationId: string;
  // カンマ区切り。`*` を含む要素は owner/repo の `/` を跨がないワイルドカードとして扱う
  allowedRepositories: string;
}

export type OidcVerifyResult =
  | { ok: true; claims: ActionsTokenClaims }
  | { ok: false; status: 401 | 403 | 503; message: string };

export function bearerToken(authorization: string | undefined) {
  const match = /^ *[Bb]earer +([A-Za-z0-9._~+/-]+=*) *$/.exec(
    authorization || ""
  );
  return match?.[1];
}

export async function verifyActionsToken(
  token: string,
  config: OidcConfig
): Promise<OidcVerifyResult> {
  let claims: ActionsTokenClaims;

  try {
    const verified = await jwtVerify<ActionsTokenClaims>(token, JWKS, {
      issuer: ISSUER,
      // 既定の audience (https://github.com/<owner>) を弾き、この repo 専用の
      // audience を要求することで、他サービス向けトークンの使い回しを防ぐ
      audience: config.audience,
      requiredClaims: ["repository", "repository_owner_id"],
    });
    claims = verified.payload;
  } catch (e) {
    // JWKS を取りに行けなかった場合は、トークンの問題ではないので 503 で返す
    if (e instanceof errors.JWKSTimeout || !(e instanceof errors.JOSEError)) {
      return {
        ok: false,
        status: 503,
        message: "Failed to fetch the GitHub Actions OIDC signing keys",
      };
    }

    return {
      ok: false,
      status: 401,
      message: `Invalid OIDC token: ${e.code}`,
    };
  }

  // org のリネーム後に第三者が同じ login を取得しても通らないよう、
  // 文字列の repository_owner ではなく不変の数値 ID で照合する
  if (claims.repository_owner_id !== config.organizationId) {
    return {
      ok: false,
      status: 403,
      message: `Organization ${claims.repository_owner} is not allowed`,
    };
  }

  if (!isAllowedRepository(claims.repository, config.allowedRepositories)) {
    return {
      ok: false,
      status: 403,
      message: `Repository ${claims.repository} is not in the allowlist`,
    };
  }

  return { ok: true, claims };
}

export function isAllowedRepository(repository: string, allowlist: string) {
  const target = repository.toLowerCase();

  return allowlist
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter((pattern) => pattern.length > 0)
    .some((pattern) => matchesPattern(target, pattern));
}

function matchesPattern(repository: string, pattern: string) {
  if (!pattern.includes("*")) {
    return repository === pattern;
  }

  // `*` は owner と repo の区切りを跨がない。`ForteFibre/*` が
  // `ForteFibre/x/y` のような値にマッチしないようにするため。
  const regexp = new RegExp(
    `^${pattern.split("*").map(escapeRegExp).join("[^/]*")}$`
  );

  return regexp.test(repository);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
