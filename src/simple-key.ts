// TODO: いつかもう少しマシな方法で書き直す

// 有効期限つきの username に付ける接頭辞。人間向けの username
// (`<login>-<id>-<timestamp>`) はこれで始まらないので、両者を区別できる。
const EXPIRING_PREFIX = "oidc.";

export interface IssuedCredentials {
  username: string;
  password: string;
  /** UNIX 秒 */
  expiresAt: number;
}

export class SimpleKey {
  constructor(private key: string) {}

  async generatePassword(user: string) {
    const shaKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const shaHash = await crypto.subtle.sign(
      "HMAC",
      shaKey,
      new TextEncoder().encode(user)
    );

    return this.hex(shaHash);
  }

  /**
   * 有効期限を username に埋め込んだ資格情報を発行する。
   * username 全体が HMAC の入力になるため期限の改竄は署名検証で弾かれ、
   * サーバ側に状態を持たずに失効を判定できる。
   */
  async issueForRepository(
    repository: string,
    ttlSeconds: number
  ): Promise<IssuedCredentials> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${EXPIRING_PREFIX}${expiresAt}.${repository}`;

    return {
      username,
      password: await this.generatePassword(username),
      expiresAt,
    };
  }

  async verify(username: string, password: string) {
    const expected = await this.generatePassword(username);

    if (!timingSafeEqual(expected, password)) {
      return false;
    }

    return !this.isExpired(username);
  }

  private isExpired(username: string) {
    if (!username.startsWith(EXPIRING_PREFIX)) {
      // 人間向けの資格情報。従来どおり無期限。
      return false;
    }

    const rest = username.slice(EXPIRING_PREFIX.length);
    const separator = rest.indexOf(".");
    if (separator <= 0) {
      // 接頭辞つきなのに期限が読めないものは受け付けない
      return true;
    }

    const expiresAt = Number(rest.slice(0, separator));
    if (!Number.isSafeInteger(expiresAt)) {
      return true;
    }

    return Math.floor(Date.now() / 1000) >= expiresAt;
  }

  private hex(bin: ArrayBuffer) {
    return [...new Uint8Array(bin)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }
}

function timingSafeEqual(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  // crypto.subtle.timingSafeEqual は長さが違うと例外を投げる
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(left, right);
}
