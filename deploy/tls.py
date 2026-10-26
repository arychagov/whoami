#!/usr/bin/env python3
"""One-time Certbot migration for this repository's existing Ubuntu deployment."""

import argparse
import contextlib
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

PROJECT_DIR = Path(__file__).resolve().parent.parent
CERT_DIR = Path("/root/certs")
LE_DIR = Path("/etc/letsencrypt")
LINEAGE = LE_DIR / "live/whoami"
WEBROOT = Path("/var/www/letsencrypt")
STATE_DIR = Path("/var/lib/whoami-tls")
HOOK = LE_DIR / "renewal-hooks/deploy/20-whoami-nginx"
CERT_FILES = {
    "domain.cert.pem": LINEAGE / "fullchain.pem",
    "private.key.pem": LINEAGE / "privkey.pem",
}


def run(args, *, capture=False, **kwargs):
    return subprocess.run(
        [str(arg) for arg in args], check=True, text=True,
        capture_output=capture, **kwargs,
    )


def atomic_write(path, content, mode=0o600):
    fd, name = tempfile.mkstemp(prefix=".whoami-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(content)
        os.replace(name, path)
    finally:
        if os.path.lexists(name):
            os.unlink(name)


def atomic_link(path, target):
    temporary = path.with_name(f".whoami-{secrets.token_hex(12)}")
    try:
        temporary.symlink_to(target)
        os.replace(temporary, path)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def validate_domains(domains):
    result = []
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    for domain in domains:
        domain = domain.lower().rstrip(".")
        if len(domain) > 253 or not re.fullmatch(rf"{label}(?:\.{label})+", domain):
            raise ValueError(f"Use a DNS hostname (ASCII/punycode), not a wildcard or URL: {domain}")
        if domain not in result:
            result.append(domain)
    return result


def compose_command(docker, project_name=None):
    command = [docker, "compose", "--project-directory", str(PROJECT_DIR),
               "-f", str(PROJECT_DIR / "docker-compose.yml")]
    if project_name:
        command.extend(["--project-name", project_name])
    return command


def running_nginx(docker, project):
    ids = run([
        docker, "ps", "--filter", f"label=com.docker.compose.project={project}",
        "--filter", "label=com.docker.compose.service=nginx",
        "--format", "{{.ID}}",
    ], capture=True).stdout.split()
    if len(ids) != 1:
        raise RuntimeError(f"Expected exactly one running nginx in Compose project {project}; found {len(ids)}")
    return ids[0]


def reload_nginx(docker, project):
    container = running_nginx(docker, project)
    run([docker, "exec", container, "nginx", "-t"])
    run([docker, "exec", container, "nginx", "-s", "reload"])


def preflight(docker, compose):
    config = json.loads(run([*compose, "config", "--format", "json"], capture=True).stdout)
    project = config["name"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise RuntimeError("Unexpected Compose project name")
    mounts = {
        volume["target"]: volume
        for volume in config["services"]["nginx"]["volumes"]
    }
    expected = {
        "/etc/nginx/conf.d": PROJECT_DIR / "deploy/nginx",
        "/etc/nginx/certs": CERT_DIR,
        "/etc/letsencrypt": LE_DIR,
        "/var/www/letsencrypt": WEBROOT,
    }
    for target, source in expected.items():
        volume = mounts.get(target, {})
        if (volume.get("type") != "bind" or volume.get("source") != str(source)
                or not volume.get("read_only")):
            raise RuntimeError(f"Expected read-only bind mount {source}:{target}; check docker-compose.yml")
    container = running_nginx(docker, project)
    actual = json.loads(run([
        docker, "inspect", "--format", "{{json .Mounts}}", container,
    ], capture=True).stdout)
    if not any(m["Destination"] == "/etc/nginx/certs" and m["Source"] == str(CERT_DIR) for m in actual):
        raise RuntimeError("Running nginx uses a different certificate directory; adapt the migration first")
    labels = json.loads(run([
        docker, "inspect", "--format", "{{json .Config.Labels}}", container,
    ], capture=True).stdout)
    if labels.get("com.docker.compose.project.config_files") != str(PROJECT_DIR / "docker-compose.yml"):
        raise RuntimeError("Run in the existing checkout; this script expects docker-compose.yml without overrides")
    for filename in CERT_FILES:
        if not (CERT_DIR / filename).is_file():
            raise RuntimeError(f"Existing deployment certificate missing: {CERT_DIR / filename}")
    return project


def certbot_installation():
    # Reuse an existing installation. A fresh installation follows Certbot's snap instructions.
    executable = "/snap/bin/certbot" if os.access("/snap/bin/certbot", os.X_OK) else shutil.which("certbot")
    if not executable:
        os_release = Path("/etc/os-release").read_text()
        if not re.search(r'^ID="?ubuntu"?$', os_release, re.MULTILINE):
            raise RuntimeError("Automatic installation supports Ubuntu. Install Certbot yourself on other systems")
        run(["apt-get", "update"])
        run(["apt-get", "install", "-y", "snapd"])
        run(["systemctl", "enable", "--now", "snapd.socket"])
        run(["snap", "wait", "system", "seed.loaded"], timeout=300)
        run(["snap", "install", "--classic", "certbot"])
        executable = "/snap/bin/certbot"
    run([executable, "--version"])
    # Do not invent a schedule for a custom installation or disable other certificates' timers.
    timer = "snap.certbot.renew.timer" if os.access("/snap/bin/certbot", os.X_OK) else "certbot.timer"
    state = run(["systemctl", "show", "--property=LoadState", "--value", timer], capture=True).stdout.strip()
    if state != "loaded":
        raise RuntimeError(f"Missing {timer}; use the Ubuntu apt or snap installation of Certbot")
    return executable, timer


def check_http(domains):
    token = f"whoami-setup-{secrets.token_hex(16)}"
    challenge = WEBROOT / ".well-known/acme-challenge" / token
    atomic_write(challenge, token.encode(), 0o644)
    try:
        for domain in domains:
            response = run([
                "curl", "--noproxy", "*", "--fail", "--silent", "--show-error",
                "--max-time", "20", f"http://{domain}/.well-known/acme-challenge/{token}",
            ], capture=True).stdout
            if response != token:
                raise RuntimeError(f"HTTP challenge did not return the test file for {domain} (check DNS, port 80 and redirects)")
    finally:
        challenge.unlink(missing_ok=True)


def check_certificate(domains):
    certificate, key = LINEAGE / "fullchain.pem", LINEAGE / "privkey.pem"
    run(["openssl", "x509", "-in", certificate, "-noout", "-checkend", "86400"], capture=True)
    for domain in domains:
        # x509 -checkhost exits 0 even for a mismatch; inspect the result too.
        match = run(["openssl", "x509", "-in", certificate, "-noout", "-checkhost", domain], capture=True).stdout.strip()
        if match != f"Hostname {domain} does match certificate":
            raise RuntimeError(f"Issued certificate does not cover {domain}")
    public_cert = run(["openssl", "x509", "-in", certificate, "-pubkey", "-noout"], capture=True).stdout
    public_key = run(["openssl", "pkey", "-in", key, "-pubout"], capture=True).stdout
    if public_cert != public_key:
        raise RuntimeError("Issued certificate and private key do not match")


def check_existing_names(domains):
    certificate = LINEAGE / "fullchain.pem"
    if certificate.exists():
        san = run(["openssl", "x509", "-in", certificate, "-noout", "-ext", "subjectAltName"], capture=True).stdout
        existing = set(re.findall(r"DNS:([^,\s]+)", san))
        if existing - set(domains):
            raise RuntimeError("Include every existing certificate name with --domain: " + ", ".join(sorted(existing)))


def hook_content(docker, project):
    # Resolve the live container by Compose labels, so a later container recreation
    # or moving the checkout does not invalidate the renewal hook.
    return f"""#!/bin/sh
set -eu
[ "${{RENEWED_LINEAGE:-}}" = {shlex.quote(str(LINEAGE))} ] || exit 0
ids=$({shlex.quote(docker)} ps \\
  --filter {shlex.quote("label=com.docker.compose.project=" + project)} \\
  --filter label=com.docker.compose.service=nginx --format '{{{{.ID}}}}')
set -f
set -- $ids
[ "$#" -eq 1 ] || {{
  echo "whoami TLS: expected one running nginx container; found $#" >&2
  exit 1
}}
{shlex.quote(docker)} exec "$1" nginx -t
{shlex.quote(docker)} exec "$1" nginx -s reload
""".encode()


def snapshot(path, destination):
    if path.is_symlink():
        return {"kind": "symlink", "target": os.readlink(path)}
    if path.exists():
        atomic_write(destination, path.read_bytes())
        return {"kind": "file", "mode": path.stat().st_mode & 0o777}
    return {"kind": "absent"}


def restore(path, saved, source):
    if saved["kind"] == "file":
        atomic_write(path, source.read_bytes(), saved["mode"])
    elif saved["kind"] == "symlink":
        atomic_link(path, saved["target"])
    elif saved["kind"] == "absent":
        path.unlink(missing_ok=True)
    else:
        raise RuntimeError("Unknown backup format")


def backup(docker, project):
    root = STATE_DIR / "backups"
    root.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-")
    directory = Path(tempfile.mkdtemp(prefix=stamp, dir=root))
    saved = {name: snapshot(CERT_DIR / name, directory / name) for name in CERT_FILES}
    saved["hook"] = snapshot(HOOK, directory / "hook")
    metadata = {"version": 1, "docker": docker, "project": project, "files": saved}
    atomic_write(directory / "state.json", json.dumps(metadata).encode())
    return directory


def restore_backup(directory):
    directory = directory.resolve()
    if directory.parent != (STATE_DIR / "backups").resolve():
        raise RuntimeError(f"Backup must be a directory directly under {STATE_DIR / 'backups'}")
    for path in (directory, directory / "state.json"):
        if path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
            raise RuntimeError("Backup must be root-owned and not writable by group/others")
    metadata = json.loads((directory / "state.json").read_text())
    if metadata.get("version") != 1:
        raise RuntimeError("Unsupported backup version")
    for name in CERT_FILES:
        restore(CERT_DIR / name, metadata["files"][name], directory / name)
    restore(HOOK, metadata["files"]["hook"], directory / "hook")
    reload_nginx(metadata["docker"], metadata["project"])


def verify_served_certificate(domain):
    expected = run([
        "openssl", "x509", "-in", LINEAGE / "fullchain.pem", "-noout", "-sha256", "-fingerprint",
    ], capture=True).stdout.strip()
    last_error = None
    # HUP is asynchronous; wait for new workers before comparing fingerprints.
    for _ in range(10):
        try:
            peer = run([
                "openssl", "s_client", "-connect", "127.0.0.1:443", "-servername", domain,
                "-verify_hostname", domain, "-verify_return_error",
            ], capture=True, input="", timeout=10).stdout
            fingerprint = run([
                "openssl", "x509", "-noout", "-sha256", "-fingerprint",
            ], capture=True, input=peer).stdout.strip()
            if fingerprint == expected:
                return
            last_error = RuntimeError("nginx is still serving a different certificate")
        except (subprocess.SubprocessError, RuntimeError) as error:
            last_error = error
        time.sleep(0.5)
    raise RuntimeError(f"Local HTTPS verification failed: {last_error}")


def activate(docker, project, domain):
    directory = backup(docker, project)
    print(f"TLS backup: {directory}", flush=True)
    try:
        for name, target in CERT_FILES.items():
            atomic_link(CERT_DIR / name, target)
        atomic_write(HOOK, hook_content(docker, project), 0o750)
        run([HOOK], env={**os.environ, "RENEWED_LINEAGE": str(LINEAGE)})
        verify_served_certificate(domain)
    except BaseException:
        print("TLS activation failed; restoring previous certificate files and hook.", file=sys.stderr)
        try:
            restore_backup(directory)
        except Exception as error:
            print(f"Automatic rollback failed: {error}. Backup: {directory}", file=sys.stderr)
        raise
    return directory


@contextlib.contextmanager
def setup_lock():
    if STATE_DIR.is_symlink():
        raise RuntimeError(f"{STATE_DIR} must not be a symlink")
    STATE_DIR.mkdir(mode=0o700, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    with (STATE_DIR / "setup.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another whoami TLS setup is running") from error
        yield


def setup(args):
    docker = shutil.which("docker")
    for executable in ("docker", "curl", "openssl", "systemctl"):
        if not shutil.which(executable):
            raise RuntimeError(f"Required host command not found: {executable}")
    compose = compose_command(docker, args.project_name)
    project = preflight(docker, compose)
    check_existing_names(args.domain)
    certbot, timer = certbot_installation()
    LE_DIR.mkdir(mode=0o755, exist_ok=True)
    HOOK.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    (WEBROOT / ".well-known/acme-challenge").mkdir(mode=0o755, parents=True, exist_ok=True)
    print("Checking and applying nginx mounts (the first migration briefly recreates nginx).", flush=True)
    run([*compose, "run", "--rm", "--no-deps", "-T", "nginx", "nginx", "-t"])
    run([*compose, "up", "-d", "--no-deps", "--no-build", "nginx"])
    reload_nginx(docker, project)
    check_http(args.domain)
    issue = [
        certbot, "certonly", "--webroot", "--webroot-path", str(WEBROOT),
        "--cert-name", "whoami", "--email", args.email, "--agree-tos",
        "--non-interactive", "--keep-until-expiring",
    ]
    for domain in args.domain:
        issue.extend(["--domain", domain])
    run(issue)
    check_certificate(args.domain)
    directory = activate(docker, project, args.domain[0])
    print("New certificate is active. Enabling and testing automatic renewal.", flush=True)
    try:
        run(["systemctl", "enable", "--now", timer])
        run(["systemctl", "is-active", "--quiet", timer])
        run([certbot, "renew", "--cert-name", "whoami", "--dry-run", "--run-deploy-hooks"])
        # Certbot can report hook errors without a failing exit code. Check it directly too.
        run([HOOK], env={**os.environ, "RENEWED_LINEAGE": str(LINEAGE)})
        verify_served_certificate(args.domain[0])
    except BaseException:
        print("HTTPS already uses the new certificate. Renewal verification failed; fix the error and rerun setup. "
              "The working certificate has been kept.", file=sys.stderr)
        raise
    run(["systemctl", "list-timers", "--all", timer])
    print(f"Done. Automatic renewal is enabled for: {', '.join(args.domain)}")
    print(f"To undo the TLS migration: sudo ./deploy/setup-tls.sh --rollback {directory}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", action="append", help="Repeat for each hostname, including www if used")
    parser.add_argument("--email", help="Let's Encrypt account email")
    parser.add_argument("--agree-tos", action="store_true", help="Accept Let's Encrypt Subscriber Agreement")
    parser.add_argument("--project-name", help="Existing Compose project name, if originally started with -p")
    parser.add_argument("--rollback", type=Path, help="Restore certificate files/hook from a printed backup directory")
    args = parser.parse_args(argv)
    if not args.rollback:
        if not args.domain or not args.email or not args.agree_tos:
            parser.error("--domain, --email and --agree-tos are required")
        args.domain = validate_domains(args.domain)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", args.email):
            parser.error("Provide a valid email address")
    if os.geteuid() != 0:
        parser.error("Run with sudo (this configures host certificates and the renewal hook)")
    os.chdir(PROJECT_DIR)
    with setup_lock():
        if args.rollback:
            restore_backup(args.rollback)
            print("Previous TLS files/hook restored. Certbot data and nginx HTTP/mount configuration were retained.")
        else:
            setup(args)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        sys.exit(130)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"TLS setup failed: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stdout or "", end="", file=sys.stderr)
            print(error.stderr or "", end="", file=sys.stderr)
        sys.exit(1)
