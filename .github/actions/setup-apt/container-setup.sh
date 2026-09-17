#!/bin/sh
# setup-apt action が組み立てた bundle の中に、この名前で setup.sh として置かれる。
# ホスト側の設定にも、bind mount したコンテナの中でもこれを使う。
#
# 資格情報も鍵も bundle に入っているので、実行にネットワークは要らない。
# curl も CA 証明書も無い素のイメージ (ubuntu:noble 等) でそのまま動く。
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
endpoint=$(cat "$here/endpoint")

# CI のコンテナは root で走り sudo が入っていないことが多いので、あるときだけ使う
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

# lsb_release は slim なイメージには入っていないが /etc/os-release は必ずある。
# ホストが noble でコンテナが jammy のような組み合わせがあるので、
# codename は必ず「実際に設定する側」で読む。
codename=$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-}")
if [ -z "$codename" ]; then
  echo "setup.sh: cannot determine VERSION_CODENAME from /etc/os-release" >&2
  exit 1
fi

# action に ros-distro を明示されていればそれを使い、無ければコンテナ側の環境に従う
if [ -f "$here/ros-distro" ]; then
  rosdistro=$(cat "$here/ros-distro")
else
  rosdistro=${ROS_DISTRO:-jazzy}
fi

$SUDO mkdir -p \
  /etc/apt/keyrings \
  /etc/apt/sources.list.d \
  /etc/apt/auth.conf.d \
  /etc/ssl/certs \
  /etc/ros/rosdep/sources.list.d

$SUDO install -m 644 "$here/fortefibre.asc" /etc/apt/keyrings/fortefibre.asc
if [ -f "$here/ca-certificates.crt" ]; then
  $SUDO install -m 644 "$here/ca-certificates.crt" /etc/ssl/certs/ca-certificates.crt
fi
# apt は world-readable な auth ファイルを警告する
$SUDO install -m 600 "$here/auth.conf" /etc/apt/auth.conf.d/fortefibre.conf

echo "deb [signed-by=/etc/apt/keyrings/fortefibre.asc] $endpoint/ $codename main" |
  $SUDO tee /etc/apt/sources.list.d/fortefibre.list > /dev/null

echo "yaml $endpoint/rosdep/$codename/$rosdistro/rosdep.yaml" |
  $SUDO tee "/etc/ros/rosdep/sources.list.d/40-fortefibre-$rosdistro.list" > /dev/null
