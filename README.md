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

| name             | default                      | description                                                                 |
| ---------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `endpoint`       | `https://apt.fortefibre.net` | apt リポジトリのベース URL                                                  |
| `audience`       | `https://apt.fortefibre.net` | 要求する OIDC audience。Worker の `OIDC_AUDIENCE` と一致必須                |
| `ros-distro`     | （空）                       | rosdep source list の distro。空なら `$ROS_DISTRO`、それも無ければ `jazzy`  |
| `configure-host` | `true`                       | action が走っているマシン自身の apt を設定するか                            |
| `apt-update`     | `true`                       | 設定後に `apt-get update` を実行するか。`configure-host: false` なら無視    |

### outputs

| name                | description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `bundle-dir`        | 持ち出せる設定一式が入ったディレクトリ                            |
| `docker-run-args`   | `docker run` に差し込む引数（bundle を read-only で mount する）  |
| `docker-build-args` | `docker build` に差し込む引数（BuildKit の secret として渡す）    |
| `expires-at`        | 発行された資格情報が失効する UNIX 時刻                            |

### docker run / docker build から使う

認証がかかっているのは `Packages` と `.deb` だけで、公開鍵 (`/fortefibre.asc`) と
rosdep の YAML は認証不要で配信している。
つまりコンテナに渡さないといけない秘密は
`/etc/apt/auth.conf.d/fortefibre.conf` の 1 行だけになる。

action は資格情報を取得すると、ホストの設定とは別に
`$RUNNER_TEMP/fortefibre-apt` へ持ち出せる一式を書き出す。

| file             | 中身                                            | 秘密 |
| ---------------- | ----------------------------------------------- | ---- |
| `auth.conf`      | `machine ... login ... password ...`（mode 600） | ◯   |
| `fortefibre.asc` | 公開鍵                                          | ×   |
| `endpoint`       | ベース URL                                      | ×   |
| `setup.sh`       | コンテナの中で走らせる設定スクリプト            | ×   |

ジョブが終わるとランナーが `$RUNNER_TEMP` ごと消す。

#### docker run

`docker-run-args` を差し込むと bundle が `/run/fortefibre-apt` に read-only で
mount されるので、コンテナの中で `setup.sh` を叩く。

```yaml
- uses: ForteFibre/apt-repository/.github/actions/setup-apt@main
  id: apt
  with:
    configure-host: false # ホストの apt は触らない
- run: |
    docker run --rm ${{ steps.apt.outputs.docker-run-args }} ros:jazzy-ros-core bash -eu -c '
      /run/fortefibre-apt/setup.sh
      apt-get update
      apt-get install -y ros-jazzy-some-package
    '
```

`setup.sh` は codename を**コンテナの** `/etc/os-release` から読むので、
ホストと中身の Ubuntu が違っていてもズレない。
資格情報も鍵も bundle に入っているので実行にネットワークは要らず、
`curl` も CA 証明書も無い `ubuntu:noble` のようなイメージでそのまま動く。

rosdep の distro は、action の `ros-distro` を明示していればそれを、
していなければコンテナ側の `$ROS_DISTRO` を使う。

`docker compose` も同じで、`volumes:` に
`${RUNNER_TEMP}/fortefibre-apt:/run/fortefibre-apt:ro` を書けばよい。

#### docker build

`auth.conf` を BuildKit の secret として渡す。
secret mount はレイヤに残らないので、出来上がったイメージに資格情報が焼き込まれない。

```dockerfile
FROM ros:jazzy-ros-core

# 鍵と sources.list は認証不要の情報なので、そのままレイヤに焼いてよい
ADD --chmod=644 https://apt.fortefibre.net/fortefibre.asc /etc/apt/keyrings/fortefibre.asc
RUN . /etc/os-release && \
    echo "deb [signed-by=/etc/apt/keyrings/fortefibre.asc] https://apt.fortefibre.net/ $VERSION_CODENAME main" \
      > /etc/apt/sources.list.d/fortefibre.list

RUN --mount=type=secret,id=fortefibre-apt,target=/etc/apt/auth.conf.d/fortefibre.conf,mode=0600 \
    apt-get update && \
    apt-get install -y --no-install-recommends ros-jazzy-some-package && \
    rm -rf /var/lib/apt/lists/*
```

```yaml
- uses: ForteFibre/apt-repository/.github/actions/setup-apt@main
  id: apt
  with:
    configure-host: false
- run: docker build ${{ steps.apt.outputs.docker-build-args }} -t my-image .
```

`docker/build-push-action` なら
`secret-files: fortefibre-apt=${{ steps.apt.outputs.bundle-dir }}/auth.conf`。

`apt-get update` と `apt-get install` は**同じ `RUN` に入れる**こと。
`Packages` も `.deb` も認証が要るので、`update` だけ secret 付きで別レイヤにすると
`install` が 401 で落ちる。

### 注意点

- **利用するリポジトリを事前に allowlist へ追加する必要がある。**
  `wrangler.jsonc` の `OIDC_ALLOWED_REPOS` を編集して deploy する。
  `ForteFibre/fibril_*` のようにワイルドカードが使える（`/` は跨がない）。
  許可されていないリポジトリからは 403 が返る。
- 発行される資格情報の有効期限は **1 時間**。
  それより長いジョブでは、期限が切れる前に action をもう一度実行する。
- fork からの `pull_request` では `id-token: write` が付与されないため、
  外部 fork の CI からこの経路で apt リポジトリを読むことはできない。
- bundle の `auth.conf` はランナーのユーザ所有の mode 600 なので、
  `docker run` するコンテナは root で動かすこと。
  `--user` で別の uid を指定すると読めない。
- `container:` 指定のジョブから nested に `docker run` する場合、
  mount のパスはホストの daemon が解決するため `$RUNNER_TEMP` が見つからず壊れる。
  `docker-run-args` / `docker-build-args` はホストランナーのステップから使う。
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
