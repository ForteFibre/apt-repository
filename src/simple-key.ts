// TODO: いつかもう少しマシな方法で書き直す

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

  private hex(bin: ArrayBuffer) {
    return [...new Uint8Array(bin)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }
}
