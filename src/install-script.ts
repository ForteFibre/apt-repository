export function installScript(username: string, password: string): string {
  return `sudo curl -fsSL https://apt.fortefibre.net/fortefibre.asc -o /etc/apt/keyrings/fortefibre.asc

  echo "yaml https://apt.fortefibre.net/rosdep/jammy/humble/rosdep.yaml" | sudo tee /etc/ros/rosdep/sources.list.d/40-fortefibre-humble.list
  
  echo \\
    "deb [signed-by=/etc/apt/keyrings/fortefibre.asc] https://apt.fortefibre.net/ jammy main" | \\
    sudo tee /etc/apt/sources.list.d/fortefibre.list > /dev/null
  
  echo machine apt.fortefibre.net login ${username} password ${password} | sudo tee /etc/apt/auth.conf.d/fortefibre.conf
  
  sudo apt-get update`;
}
