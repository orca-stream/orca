import type { Config } from "./config.ts";
import { BifrostError } from "./errors.ts";

export interface HostFile {
  path: string;
  content: string;
  mode: string;
}

/** One idempotent unit of host preparation: skipped when `probe` exits 0. */
export interface HostStep {
  id: string;
  title: string;
  /** A read-only shell snippet; exit 0 means this step is already done. */
  probe: string;
  files?: HostFile[];
  /** Run after the files are written. */
  script?: string;
  /** After running, a brand-new key login must still work, or `rollback` runs and the step fails. */
  verifyAccess?: boolean;
  rollback?: string;
}

export const SSHD_DROPIN = "/etc/ssh/sshd_config.d/10-bifrost.conf";
export const DOCKER_MEDIA_DROPIN = "/etc/systemd/system/docker.service.d/10-bifrost-media.conf";
export const SYSCTL_FILE = "/etc/sysctl.d/60-bifrost.conf";

const lines = (...l: string[]) => `${l.join("\n")}\n`;

export const SSHD_DROPIN_CONTENT = lines(
  "# Managed by Bifrost. Drop-ins are read in lexical order and the first value wins,",
  "# so this file beats the `PasswordAuthentication yes` in 50-cloud-init.conf.",
  "PasswordAuthentication no",
  "KbdInteractiveAuthentication no",
  "PermitRootLogin no",
  "PubkeyAuthentication yes",
);

/** True when sshd already runs with password logins off. Needs root. */
export const SSHD_HARDENED_PROBE =
  "out=$(sshd -T) && for l in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin no' 'pubkeyauthentication yes'; do " +
  'printf \'%s\\n\' "$out" | grep -qix "$l" || exit 1; done';

/** True when every package is installed. `dpkg -s` would also say yes to removed-but-not-purged ones. */
function pkgsInstalled(...names: string[]): string {
  return (
    `for p in ${names.join(" ")}; do ` +
    '[ "$(dpkg-query -W -f=\'${Status}\' "$p" 2>/dev/null)" = "install ok installed" ] || exit 1; done'
  );
}

const DOCKER_PACKAGES =
  "docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin";

/** The steps before the sshd hardening, in order. The firewall comes last so its SSH rule exists first. */
export function prepareSteps(cfg: Config, opts: { withDisk: boolean }): HostStep[] {
  const { lanCidr } = cfg.host;
  const steps: HostStep[] = [
    {
      id: "packages",
      title: "base packages (ca-certificates, curl, ufw, restic, unattended-upgrades)",
      probe: pkgsInstalled("ca-certificates", "curl", "ufw", "restic", "unattended-upgrades"),
      script: lines(
        "export DEBIAN_FRONTEND=noninteractive",
        "apt-get update -qq",
        "apt-get install -y -qq ca-certificates curl ufw restic unattended-upgrades",
      ),
    },
    {
      id: "docker",
      title: "Docker Engine from Docker's own apt repository",
      probe: `${pkgsInstalled(...DOCKER_PACKAGES.split(" "))} && systemctl is-active --quiet docker`,
      script: lines(
        "set -o pipefail",
        "export DEBIAN_FRONTEND=noninteractive",
        "for pkg in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do",
        '  apt-get remove -y -qq "$pkg" || true',
        "done",
        "install -m 0755 -d /etc/apt/keyrings",
        "curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc",
        "chmod a+r /etc/apt/keyrings/docker.asc",
        ". /etc/os-release",
        "cat > /etc/apt/sources.list.d/docker.sources <<EOF",
        "Types: deb",
        "URIs: https://download.docker.com/linux/ubuntu",
        "Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}",
        "Components: stable",
        "Architectures: $(dpkg --print-architecture)",
        "Signed-By: /etc/apt/keyrings/docker.asc",
        "EOF",
        "apt-get update -qq",
        `apt-get install -y -qq ${DOCKER_PACKAGES}`,
        "systemctl enable --now docker",
      ),
    },
    {
      id: "user",
      title: "dedicated jellyfin system user",
      probe: "id -u jellyfin >/dev/null 2>&1",
      script: lines(
        "useradd --system --no-create-home --shell /usr/sbin/nologin --user-group jellyfin",
      ),
    },
    {
      id: "sysctl",
      title: "net.ipv4.ip_nonlocal_bind=1 (bind to the LAN address before Wi-Fi is up)",
      probe: `[ "$(sysctl -n net.ipv4.ip_nonlocal_bind)" = 1 ] && [ -f ${SYSCTL_FILE} ]`,
      files: [{ path: SYSCTL_FILE, content: "net.ipv4.ip_nonlocal_bind=1\n", mode: "0644" }],
      script: lines(`sysctl -q -p ${SYSCTL_FILE}`),
    },
    {
      id: "unattended-upgrades",
      title: "unattended-upgrades enabled",
      probe: `grep -qs 'APT::Periodic::Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades`,
      files: [
        {
          path: "/etc/apt/apt.conf.d/20auto-upgrades",
          content: lines(
            'APT::Periodic::Update-Package-Lists "1";',
            'APT::Periodic::Unattended-Upgrade "1";',
          ),
          mode: "0644",
        },
      ],
    },
    {
      id: "ufw",
      title: `firewall: deny incoming, SSH allowed from ${lanCidr}`,
      probe: `ufw status | grep -q '^Status: active' && ufw status | grep -qE '^22/tcp +ALLOW +${lanCidr}'`,
      // The SSH rule goes in BEFORE `enable`, or the session that is running this would be cut off.
      script: lines(
        "ufw default deny incoming",
        "ufw default allow outgoing",
        `ufw allow from ${lanCidr} to any port 22 proto tcp`,
        "ufw --force enable",
      ),
      // If the firewall locks us out, the next key login fails: switch it off again from this session.
      verifyAccess: true,
      rollback: "ufw --force disable",
    },
  ];

  if (opts.withDisk) {
    const disk = cfg.host.mediaDisk;
    if (!disk) {
      throw new BifrostError("--with-disk needs host.mediaDisk (uuid and mount) in the config.");
    }
    steps.push({
      id: "media-disk",
      title: `mount the media disk ${disk.uuid} at ${disk.mount}`,
      probe: `grep -q 'UUID=${disk.uuid} ' /etc/fstab && mountpoint -q ${disk.mount} && [ -f ${DOCKER_MEDIA_DROPIN} ]`,
      // Docker (and so the container) must not start without the disk, or Jellyfin would scan an
      // empty directory on the root disk and drop the library.
      files: [
        {
          path: DOCKER_MEDIA_DROPIN,
          content: lines("[Unit]", `RequiresMountsFor=${disk.mount}`),
          mode: "0644",
        },
      ],
      script: lines(
        `blkid -U ${disk.uuid} >/dev/null || { echo "no disk with UUID ${disk.uuid} is connected" >&2; exit 1; }`,
        `mkdir -p ${disk.mount}`,
        `grep -q 'UUID=${disk.uuid} ' /etc/fstab || echo 'UUID=${disk.uuid} ${disk.mount} ext4 defaults,nofail,x-systemd.device-timeout=10 0 2' >> /etc/fstab`,
        "systemctl daemon-reload",
        "mount -a",
      ),
    });
  }
  return steps;
}
