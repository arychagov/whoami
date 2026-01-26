FROM alpine:3.20

RUN apk add --no-cache logrotate busybox-suid

COPY logrotate.conf /etc/logrotate.conf
COPY whoami-nginx /etc/logrotate.d/whoami-nginx

# Run logrotate every minute (busybox crond)
COPY crontab /etc/crontabs/root

CMD ["crond", "-f", "-l", "8"]

