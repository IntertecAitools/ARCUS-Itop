#!/bin/bash
# First boot of the IRAOPS server: Docker, the AWS and Azure command-line
# tools, swap, the /opt/arcus layout, the nightly copy of backups to Azure
# Storage, and the release agent. The application arrives with the first
# approved release (deploy/azure/README.md).
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
# Ubuntu's own updates may hold the package lock on first boot: wait for it.
apt() { apt-get -o DPkg::Lock::Timeout=900 "$@"; }

apt update
apt install -y ca-certificates curl unzip jq gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
# Microsoft's packages: the Azure CLI and azcopy.
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ noble main" \
  > /etc/apt/sources.list.d/azure-cli.list
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main" \
  > /etc/apt/sources.list.d/microsoft-prod.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin azure-cli azcopy

mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
JSON
systemctl enable --now docker
systemctl restart docker

curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install --update
rm -rf /tmp/aws /tmp/awscliv2.zip

# 2 GB of swap: the iTop setup and image pulls peak above RAM on a small box.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/arcus/releases /opt/arcus/state /opt/arcus/shared /opt/arcus/backups /opt/arcus/aws
chmod 700 /opt/arcus/shared /opt/arcus/backups
# The AWS token is read by the BFF container (user node, uid 1000) for licence signing.
chown root:1000 /opt/arcus/aws
chmod 750 /opt/arcus/aws

# Where this server's settings and backups live (Terraform fills these in).
cat > /opt/arcus/state/azure.env <<'ENV'
KEY_VAULT=${key_vault}
BACKUP_ACCOUNT=${backup_account}
ENV

# The backup container writes one folder a night; copy them off the server.
cat > /etc/cron.d/arcus-backup-azure <<'CRON'
SHELL=/bin/bash
30 3 * * * root . /opt/arcus/state/azure.env && AZCOPY_AUTO_LOGIN_TYPE=MSI azcopy sync /opt/arcus/backups "https://$BACKUP_ACCOUNT.blob.core.windows.net/daily" --recursive --log-level ERROR >/dev/null
CRON

# The release agent: every minute, asks whether a release was approved and
# deploys it (deploy/azure/server/release-agent.sh; each release brings its
# own copy, this one starts the first).
base64 -d > /usr/local/bin/iraops-release-agent <<'B64'
${release_agent_b64}
B64
chmod 755 /usr/local/bin/iraops-release-agent
cat > /etc/systemd/system/iraops-release.service <<'UNIT'
[Unit]
Description=IRAOPS release agent (one check)
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/iraops-release-agent
UNIT
cat > /etc/systemd/system/iraops-release.timer <<'UNIT'
[Unit]
Description=IRAOPS release agent, every minute
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now iraops-release.timer

touch /opt/arcus/state/bootstrap.done
