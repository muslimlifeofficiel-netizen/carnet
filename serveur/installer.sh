#!/usr/bin/env bash
# Carnet de Suivi : installation sécurisée du serveur (Ubuntu, VPS OVH).
# Usage : sudo bash installer.sh carnet.muslimlifefitness.com "ssh-ed25519 AAAA... sami-carnet"
# Ne contient aucun secret. Peut être relancé sans danger.
set -euo pipefail
DOMAINE="${1:?Donne le nom de domaine, ex. carnet.muslimlifefitness.com}"
CLE="${2:?Donne ta clé publique SSH (ligne qui commence par ssh-ed25519)}"
PB_VERSION="0.40.6"
PB_SHA256="0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f"
UTIL="${SUDO_USER:-ubuntu}"

echo "== 1/7 Mises à jour du système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ufw fail2ban unattended-upgrades unzip curl caddy sqlite3

echo "== 2/7 Clé SSH de Sami (la connexion par mot de passe sera coupée à l'étape suivante, après ton test)"
install -d -m 700 -o "$UTIL" -g "$UTIL" "/home/$UTIL/.ssh"
touch "/home/$UTIL/.ssh/authorized_keys"
grep -qxF "$CLE" "/home/$UTIL/.ssh/authorized_keys" || echo "$CLE" >> "/home/$UTIL/.ssh/authorized_keys"
chown "$UTIL:$UTIL" "/home/$UTIL/.ssh/authorized_keys"; chmod 600 "/home/$UTIL/.ssh/authorized_keys"

echo "== 3/7 Pare-feu : seulement SSH, HTTP et HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== 4/7 Anti-intrusion (fail2ban) et mises à jour de sécurité automatiques"
cat > /etc/fail2ban/jail.d/carnet.conf <<CONF
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 24h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades <<CONF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/52carnet-reboot <<CONF
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
CONF

echo "== 5/7 PocketBase $PB_VERSION (version figée, empreinte vérifiée)"
id carnet >/dev/null 2>&1 || useradd --system --home /opt/carnet --shell /usr/sbin/nologin carnet
install -d -m 750 -o carnet -g carnet /opt/carnet /opt/carnet/pb_data /opt/carnet/pb_hooks /opt/carnet/pb_public
install -d -m 700 /etc/carnet
[ -f /etc/carnet/env ] || { touch /etc/carnet/env; chmod 600 /etc/carnet/env; }
TMP=$(mktemp -d)
curl -fsSL -o "$TMP/pb.zip" "https://github.com/pocketbase/pocketbase/releases/download/v$PB_VERSION/pocketbase_${PB_VERSION}_linux_amd64.zip"
echo "$PB_SHA256  $TMP/pb.zip" | sha256sum -c -
unzip -o -q "$TMP/pb.zip" pocketbase -d /opt/carnet
chown carnet:carnet /opt/carnet/pocketbase; chmod 750 /opt/carnet/pocketbase
rm -rf "$TMP"
cat > /etc/systemd/system/carnet.service <<CONF
[Unit]
Description=Carnet de Suivi (PocketBase)
After=network-online.target
Wants=network-online.target

[Service]
User=carnet
Group=carnet
EnvironmentFile=/etc/carnet/env
ExecStart=/opt/carnet/pocketbase serve --http=127.0.0.1:8090 --dir=/opt/carnet/pb_data --hooksDir=/opt/carnet/pb_hooks --publicDir=/opt/carnet/pb_public
Restart=always
RestartSec=3
LimitNOFILE=4096
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=/opt/carnet

[Install]
WantedBy=multi-user.target
CONF
systemctl daemon-reload
systemctl enable --now carnet
systemctl restart carnet

echo "== 6/7 HTTPS automatique (Caddy) ; l'administration n'est pas accessible depuis internet"
cat > /etc/caddy/Caddyfile <<CONF
$DOMAINE {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		Permissions-Policy "geolocation=(), microphone=(), camera=(self)"
		-Server
	}
	@admin path /_/* /api/collections/_superusers/*
	respond @admin 403
	reverse_proxy 127.0.0.1:8090
}
CONF
systemctl reload caddy || systemctl restart caddy

echo "== 7/7 Contrôle"
sleep 2
systemctl is-active carnet caddy fail2ban
ufw status | head -8
echo
echo "FINI. Teste maintenant, depuis ton PC, dans une NOUVELLE fenêtre : ssh $UTIL@<IP>"
echo "Si tu entres SANS mot de passe : lance  sudo bash verrouiller-ssh.sh"
