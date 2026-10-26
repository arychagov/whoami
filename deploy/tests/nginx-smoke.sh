#!/usr/bin/env bash
# Isolated Docker smoke test. All certificates are disposable and self-signed.
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d)"
project="whoami-tls-test-$$"
nginx_name="$project-nginx"
app_name="$project-app"
network="$project-network"
nginx_image="nginx:1.27-alpine"

cleanup() {
  docker rm -f "$nginx_name" "$app_name" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$test_dir"
}
trap cleanup EXIT

mkdir -p "$test_dir"/{certs,logs,public,letsencrypt/live/whoami,letsencrypt/archive/whoami}
mkdir -p "$test_dir/webroot/.well-known/acme-challenge"
# Only the mounted webroots need worker-readable permissions.
chmod 755 "$test_dir/public" "$test_dir/webroot"
printf 'acme-ok' > "$test_dir/webroot/.well-known/acme-challenge/probe"
printf 'static-ok' > "$test_dir/public/index.html"
cat > "$test_dir/upstream.conf" <<'EOF'
server {
  listen 3000;
  location / { return 200 "upstream-ok"; }
}
EOF

certificate() {
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -sha256 \
    -subj '/CN=example.test' -addext 'subjectAltName=DNS:example.test' \
    -keyout "$1" -out "$2" >/dev/null 2>&1
}
certificate "$test_dir/certs/private.key.pem" "$test_dir/certs/domain.cert.pem"
certificate "$test_dir/letsencrypt/archive/whoami/privkey1.pem" "$test_dir/letsencrypt/archive/whoami/fullchain1.pem"
certificate "$test_dir/letsencrypt/archive/whoami/privkey2.pem" "$test_dir/letsencrypt/archive/whoami/fullchain2.pem"
ln -s ../../archive/whoami/fullchain1.pem "$test_dir/letsencrypt/live/whoami/fullchain.pem"
ln -s ../../archive/whoami/privkey1.pem "$test_dir/letsencrypt/live/whoami/privkey.pem"

docker network create "$network" >/dev/null
docker run -d --name "$app_name" --network "$network" --network-alias app \
  -v "$test_dir/upstream.conf:/etc/nginx/conf.d/default.conf:ro" "$nginx_image" >/dev/null
docker run -d --name "$nginx_name" --network "$network" \
  --label "com.docker.compose.project=$project" --label com.docker.compose.service=nginx \
  -p 127.0.0.1::80 -p 127.0.0.1::443 \
  -v "$repo_dir/deploy/nginx:/etc/nginx/conf.d:ro" \
  -v "$test_dir/certs:/etc/nginx/certs:ro" \
  -v "$test_dir/letsencrypt:/etc/letsencrypt:ro" \
  -v "$test_dir/webroot:/var/www/letsencrypt:ro" \
  -v "$test_dir/public:/var/www/public:ro" \
  -v "$test_dir/logs:/root/logs" "$nginx_image" >/dev/null
http_address="$(docker port "$nginx_name" 80/tcp)"
tls_address="$(docker port "$nginx_name" 443/tcp)"
tls_port="${tls_address##*:}"
started="$(docker inspect --format '{{.Id}} {{.State.StartedAt}}' "$nginx_name")"

test "$(curl --noproxy '*' --fail --silent --show-error --retry 10 --retry-connrefused \
  --retry-delay 1 --max-time 5 "http://$http_address/.well-known/acme-challenge/probe")" = acme-ok
test "$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' "http://$http_address/")" = 301
test "$(curl --noproxy '*' -kfsS "https://$tls_address/api/health")" = upstream-ok

python3 - "$repo_dir" "$project" > "$test_dir/hook" <<'PY'
import shutil, sys
sys.path.insert(0, sys.argv[1] + "/deploy")
import tls
sys.stdout.buffer.write(tls.hook_content(shutil.which("docker"), sys.argv[2]))
PY
chmod 750 "$test_dir/hook"
run_hook() {
  RENEWED_LINEAGE=/etc/letsencrypt/live/whoami "$test_dir/hook"
}
served_fingerprint() {
  openssl s_client -connect "$tls_address" -servername example.test </dev/null 2>/dev/null |
    openssl x509 -noout -sha256 -fingerprint
}
wait_for_certificate() {
  local expected
  expected="$(openssl x509 -in "$1" -noout -sha256 -fingerprint)"
  for ((attempt = 0; attempt < 30; attempt++)); do
    if [[ "$(served_fingerprint)" == "$expected" ]]; then
      return 0
    fi
    sleep 0.2
  done
  echo "nginx did not serve the expected certificate" >&2
  return 1
}

# Switch the legacy filenames to the new mounted lineage.
ln -s /etc/letsencrypt/live/whoami/fullchain.pem "$test_dir/certs/cert.next"
mv -Tf "$test_dir/certs/cert.next" "$test_dir/certs/domain.cert.pem"
ln -s /etc/letsencrypt/live/whoami/privkey.pem "$test_dir/certs/key.next"
mv -Tf "$test_dir/certs/key.next" "$test_dir/certs/private.key.pem"
run_hook
wait_for_certificate "$test_dir/letsencrypt/archive/whoami/fullchain1.pem"

# A partial/broken rotation must not reload nginx.
ln -s ../../archive/whoami/fullchain2.pem "$test_dir/letsencrypt/live/whoami/cert.next"
mv -Tf "$test_dir/letsencrypt/live/whoami/cert.next" "$test_dir/letsencrypt/live/whoami/fullchain.pem"
if run_hook; then
  echo "Expected nginx -t to reject a mismatched certificate/key pair" >&2
  exit 1
fi
wait_for_certificate "$test_dir/letsencrypt/archive/whoami/fullchain1.pem"

# Complete rotation and check the real hook, trust chain and container identity.
ln -s ../../archive/whoami/privkey2.pem "$test_dir/letsencrypt/live/whoami/key.next"
mv -Tf "$test_dir/letsencrypt/live/whoami/key.next" "$test_dir/letsencrypt/live/whoami/privkey.pem"
run_hook
wait_for_certificate "$test_dir/letsencrypt/archive/whoami/fullchain2.pem"
test "$(curl --noproxy '*' --fail --silent --show-error \
  --cacert "$test_dir/letsencrypt/archive/whoami/fullchain2.pem" \
  --resolve "example.test:$tls_port:127.0.0.1" "https://example.test:$tls_port/index.html")" = static-ok
test "$(docker inspect --format '{{.Id}} {{.State.StartedAt}}' "$nginx_name")" = "$started"
test "$(curl --noproxy '*' -fsS "http://$http_address/.well-known/acme-challenge/probe")" = acme-ok
echo "PASS: ACME routing, TLS migration, failed rotation guard and renewal without container recreation"
