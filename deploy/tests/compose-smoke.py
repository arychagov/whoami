#!/usr/bin/env python3
"""Exercise real Compose V1/V2 config, preflight and nginx-only recreation."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tls


def main():
    repo = tls.PROJECT_DIR
    docker = shutil.which("docker")
    frontend = os.environ.get("TEST_COMPOSE_FRONTEND", "plugin")
    project = f"whoami-compose-test-{os.getpid()}"
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        tls.PROJECT_DIR = root
        tls.CERT_DIR = root / "certs"
        tls.LE_DIR = root / "letsencrypt"
        tls.WEBROOT = root / "webroot"
        for directory in [tls.CERT_DIR, tls.LE_DIR, tls.WEBROOT / ".well-known/acme-challenge", root / "public"]:
            directory.mkdir(parents=True)
        shutil.copytree(repo / "deploy/nginx", root / "deploy/nginx")
        (root / "app.conf").write_text('server { listen 3000; location / { return 200 "upstream-ok"; } }\n')
        (tls.WEBROOT / ".well-known/acme-challenge/probe").write_text("acme-ok")
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
            "-subj", "/CN=example.test", "-keyout", str(tls.CERT_DIR / "private.key.pem"),
            "-out", str(tls.CERT_DIR / "domain.cert.pem"),
        ], check=True, capture_output=True)
        config = {"services": {
            "app": {"image": "nginx:1.27-alpine", "volumes": ["./app.conf:/etc/nginx/conf.d/default.conf:ro"]},
            "nginx": {"image": "nginx:1.27-alpine", "depends_on": ["app"],
                      "ports": ["127.0.0.1::80", "127.0.0.1::443"],
                      "volumes": [
                          "./deploy/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro",
                          f"{tls.CERT_DIR}:/etc/nginx/certs:ro", "./public:/var/www/public:ro",
                          "logs:/root/logs",
                      ]},
        }, "volumes": {"logs": {}}}
        path = root / "docker-compose.yml"
        path.write_text(json.dumps(config))
        compose = tls.compose_command(docker, project, frontend)
        try:
            tls.run([*compose, "up", "-d", "--no-build"])
            old_nginx = tls.running_nginx(docker, project)
            app = tls.run([*compose, "ps", "-q", "app"], capture=True).stdout.strip()
            app_started = tls.run([docker, "inspect", "--format", "{{.State.StartedAt}}", app], capture=True).stdout
            tls.run([docker, "exec", old_nginx, "sh", "-c", "echo preserved > /root/logs/.preserve-test"])
            config["services"]["nginx"]["volumes"][0] = "./deploy/nginx:/etc/nginx/conf.d:ro"
            config["services"]["nginx"]["volumes"].extend([
                f"{tls.LE_DIR}:/etc/letsencrypt:ro", f"{tls.WEBROOT}:/var/www/letsencrypt:ro",
            ])
            path.write_text(json.dumps(config))
            assert tls.preflight(docker, compose) == project
            tls.run([*compose, "run", "--rm", "--no-deps", "-T", "nginx", "nginx", "-t"])
            tls.run([*compose, "up", "-d", "--no-deps", "--no-build", "--renew-anon-volumes", "nginx"])
            tls.reload_nginx(docker, project)
            new_nginx = tls.running_nginx(docker, project)
            assert new_nginx != old_nginx, "Migration must apply new mounts"
            assert tls.run([*compose, "ps", "-q", "app"], capture=True).stdout.strip() == app
            assert tls.run([docker, "inspect", "--format", "{{.State.StartedAt}}", app], capture=True).stdout == app_started
            assert tls.run([docker, "exec", new_nginx, "cat", "/root/logs/.preserve-test"], capture=True).stdout.strip() == "preserved"
            address = tls.run([docker, "port", new_nginx, "80/tcp"], capture=True).stdout.strip()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(f"http://{address}/.well-known/acme-challenge/probe", timeout=10) as response:
                assert response.read() == b"acme-ok"
            print("PASS: Compose config, project labels, nginx-only migration and named-volume preservation")
        finally:
            # This project contains only disposable test data and random loopback ports.
            subprocess.run([*compose, "down", "--volumes", "--remove-orphans"], check=True)


if __name__ == "__main__":
    main()
