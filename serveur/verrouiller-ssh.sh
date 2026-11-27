#!/usr/bin/env bash
# À lancer SEULEMENT après avoir vérifié que la connexion par clé marche (sinon tu te bloques dehors ;
# la console KVM de l'espace client OVH reste alors la porte de secours).
set -euo pipefail
UTIL="${SUDO_USER:-ubuntu}"
[ -s "/home/$UTIL/.ssh/authorized_keys" ] || { echo "Aucune clé installée : arrêt."; exit 1; }
cat > /etc/ssh/sshd_config.d/99-carnet.conf <<CONF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers $UTIL
CONF
sshd -t
systemctl reload ssh
echo "SSH verrouillé : clé seulement, pas de root, pas de mot de passe."
