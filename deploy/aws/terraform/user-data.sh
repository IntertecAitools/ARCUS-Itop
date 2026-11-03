#!/bin/bash
# First boot of the Arcus Servicedesk server: Docker, the AWS CLI, swap, the
# /opt/arcus layout and the nightly copy of backups to S3. The application
# itself arrives with the first pipeline deploy (deploy/aws/server/deploy.sh).
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
# Ubuntu's own updates may hold the package lock on first boot: wait for it.
apt() { apt-get -o DPkg::Lock::Timeout=900 "$@"; }

apt update
apt install -y ca-certificates curl unzip jq
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

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

mkdir -p /opt/arcus/releases /opt/arcus/state /opt/arcus/shared /opt/arcus/backups
chmod 700 /opt/arcus/shared /opt/arcus/backups

# The backup container writes one folder a night; copy them off the server.
cat > /etc/cron.d/arcus-backup-s3 <<'CRON'
SHELL=/bin/bash
30 3 * * * root /usr/local/bin/aws s3 sync /opt/arcus/backups s3://${backup_bucket}/daily/ --region ${region} --only-show-errors
CRON

touch /opt/arcus/state/bootstrap.done
