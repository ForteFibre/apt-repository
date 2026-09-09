# ForteFibre APT repository

`https://apt.fortefibre.net` を配信する Cloudflare Worker。
R2 に置いた apt リポジトリを Basic 認証で保護し、rosdep 用の YAML も生成する。

認証の入口は 2 つある。

- **人間**: GitHub OAuth でログインすると、`/credentials` で無期限の username / password が得られる
- **GitHub Actions**: OIDC トークンを有効期限 1 時間の資格情報に交換する（長期 secret を置かなくてよい）

## GitHub Actions から使う

```yaml
permissions:
  contents: read
  id-token: write # これが無いと OIDC トークンを取得できない

steps:
  - uses: ForteFibre/apt-repository/.github/actions/setup-apt@main
  - run: apt-get install -y ros-jazzy-some-package
```

action は OIDC トークンを取得して `apt.fortefibre.net` に提示し、検証が通れば
その場で発行された資格情報で `/etc/apt/auth.conf.d/fortefibre.conf`、
`/etc/apt/sources.list.d/fortefibre.list`、rosdep の source list を設定する。
既定では最後に `apt-get update` まで実行する。

`ubuntu:noble` のように `curl` が入っていないイメージでは自動で導入する。
`ros:jazzy-ros-core` のように `sudo` が無い root コンテナでもそのまま動く。

### inputs

| name         | default                      | description                                                                |
| ------------ | ---------------------------- | -------------------------------------------------------------------------- |
| `endpoint`   | `https://apt.fortefibre.net` | apt リポジトリのベース URL                                                 |
| `audience`   | `https://apt.fortefibre.net` | 要求する OIDC audience。Worker の `OIDC_AUDIENCE` と一致必須               |
| `ros-distro` | （空）                       | rosdep source list の distro。空なら `$ROS_DISTRO`、それも無ければ `jazzy` |
| `apt-update` | `true`                       | 設定後に `apt-get update` を実行するか                                     |

### 注意点

- **利用するリポジトリを事前に allowlist へ追加する必要がある。**
  `wrangler.jsonc` の `OIDC_ALLOWED_REPOS` を編集して deploy する。
  `ForteFibre/fibril_*` のようにワイルドカードが使える（`/` は跨がない）。
  許可されていないリポジトリからは 403 が返る。
- 発行される資格情報の有効期限は **1 時間**。
  それより長いジョブでは、期限が切れる前に action をもう一度実行する。
- fork からの `pull_request` では `id-token: write` が付与されないため、
  外部 fork の CI からこの経路で apt リポジトリを読むことはできない。
- GitHub の既定 audience（`https://github.com/ForteFibre`）のトークンは拒否する。
  他サービス向けに発行されたトークンの使い回しを防ぐため。

### action を使わない場合

```yaml
- shell: bash # 既定の `bash -e {0}` と違い pipefail が付く
  run: |
    token=$(curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=https://apt.fortefibre.net" \
      | sed -e 's/.*"value":"\([^"]*\)".*/\1/')
    curl -sSf -o /tmp/setup.sh -H "Authorization: Bearer $token" \
      https://apt.fortefibre.net/oidc/install.bash
    bash -eu /tmp/setup.sh
    apt-get update
```

`curl ... | bash` とパイプで直接繋がないこと。
`run:` の既定シェルは `bash -e {0}` で `pipefail` が付かないため、
curl が 401 でも bash は空入力で正常終了し、ステップが緑のまま通ってしまう。

資格情報を JSON で受け取りたい場合は `/oidc/install.bash` の代わりに
`/oidc/credentials` を使う（`{ "username", "password", "expires_at" }` が返る）。
その場合は password を `echo "::add-mask::$password"` でマスクすること。

## 開発

```
pnpm install
pnpm run dev
```

```
pnpm run deploy
```

`wrangler.jsonc` を変更したら型を再生成する。

```
pnpm run cf-typegen
```

OIDC の疎通は手元では確認できないので、`.github/workflows/test-oidc.yml` を
`workflow_dispatch` で実行して検証する。
