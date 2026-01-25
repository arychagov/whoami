Put your TLS cert files here (not committed to git).

This project is currently configured for Porkbun-provided filenames:

- `domain.cert.pem`
- `private.key.pem`
- (`public.key.pem` is not used by nginx, but you can keep it here if you want)

Deployment assumes certs are stored on the server in:

- `/root/certs`

and mounted into nginx as `/etc/nginx/certs`.

