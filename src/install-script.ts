export function installScript(username: string, password: string): string {
  // このスクリプトは /credentials の画面で人間がターミナルに貼り付ける用途にも使う。
  // `set -e` や `exit` を入れると貼り付けた対話シェルごと落ちてしまうので入れない。
  // CI では composite action が `bash -eu` で実行して厳格に落とす。
  return `
# CI のコンテナは root で走り sudo が入っていないことが多いので、あるときだけ使う
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

# lsb_release は slim なイメージには入っていないが /etc/os-release は必ずある
RELEASE_CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
ROSDISTRO=\${ROS_DISTRO:-jazzy}

$SUDO mkdir -p \\
  /etc/apt/keyrings \\
  /etc/apt/sources.list.d \\
  /etc/apt/auth.conf.d \\
  /etc/ros/rosdep/sources.list.d

$SUDO curl -fsSL https://apt.fortefibre.net/fortefibre.asc \\
  -o /etc/apt/keyrings/fortefibre.asc

echo "yaml https://apt.fortefibre.net/rosdep/$RELEASE_CODENAME/$ROSDISTRO/rosdep.yaml" | \\
  $SUDO tee /etc/ros/rosdep/sources.list.d/40-fortefibre-$ROSDISTRO.list > /dev/null

echo "deb [signed-by=/etc/apt/keyrings/fortefibre.asc] https://apt.fortefibre.net/ $RELEASE_CODENAME main" | \\
  $SUDO tee /etc/apt/sources.list.d/fortefibre.list > /dev/null

echo "machine apt.fortefibre.net login ${username} password ${password}" | \\
  $SUDO tee /etc/apt/auth.conf.d/fortefibre.conf > /dev/null
# apt は world-readable な auth ファイルを警告する
$SUDO chmod 600 /etc/apt/auth.conf.d/fortefibre.conf
`;
}
