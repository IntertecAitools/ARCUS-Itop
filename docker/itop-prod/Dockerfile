# iTop for production: the repository's iTop/ baked into the image (no bind
# mount), served by Apache with only the web services the BFF uses open.
# Build from the repository root:
#
#   docker build -f docker/itop-prod/Dockerfile -t arcus-itop .
#
# The PHP setup is the same as docker/Dockerfile (the local image); keep the
# two in step. What the installer writes (conf/, data/, env-production/, log/)
# lives in volumes, see docker/docker-compose.prod.yml.

ARG PHP_IMAGE=php:8.3-apache
FROM ${PHP_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
        libzip-dev \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libxml2-dev \
        libldap2-dev \
        libcurl4-openssl-dev \
        unzip \
        graphviz \
        mariadb-client \
    && rm -rf /var/lib/apt/lists/*

# MariaDB client 11.x verifies the server certificate by default; MySQL 8
# presents a self-signed one (iTop's own backup feature shells out to it).
RUN echo '[client]' > /etc/mysql/conf.d/99-itop.cnf \
    && echo 'ssl-verify-server-cert=0' >> /etc/mysql/conf.d/99-itop.cnf

RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-configure ldap --with-libdir=lib/$(dpkg-architecture -q DEB_HOST_MULTIARCH)/ \
    && docker-php-ext-install -j"$(nproc)" \
        mysqli \
        soap \
        zip \
        gd \
        ldap \
        opcache

# Recommended by the installer (performance). A layer of its own: it needs
# pecl.php.net, which can fail on its own without losing the build above.
RUN pecl install apcu-5.1.24 \
    && docker-php-ext-enable apcu

RUN a2enmod rewrite headers \
    && mkdir -p /var/lib/php/sessions \
    && chown www-data:www-data /var/lib/php/sessions \
    && chmod 1733 /var/lib/php/sessions

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-itop.ini
# The code no longer changes under a running container: no need to re-stat.
RUN printf 'opcache.revalidate_freq = 2\nexpose_php = Off\n' > /usr/local/etc/php/conf.d/zz-itop-prod.ini
COPY docker/itop-prod/apache.conf /etc/apache2/conf-available/itop.conf
RUN a2enconf itop && a2disconf other-vhosts-access-log

# The code is root's and read-only to Apache; only the directories iTop writes
# to are www-data's. They are volumes, so an empty volume starts with this
# ownership.
COPY --chown=root:root iTop/ /var/www/html/
# The base image leaves /var/www/html world-writable and www-data's.
# env-production-build is the setup's scratch copy of the compiled data model
# (emptied once copied into env-production), so it needs no volume.
RUN chown root:root /var/www/html && chmod 755 /var/www/html \
    && cd /var/www/html \
    && mkdir -p conf data env-production env-production-build log \
    && chown -R www-data:www-data conf data env-production env-production-build log

COPY docker/itop-prod/install.xml.tpl docker/itop-prod/configure.php /opt/arcus/
COPY --chmod=755 docker/itop-prod/entrypoint.sh /usr/local/bin/itop-entrypoint
COPY --chmod=755 docker/itop-prod/itop-setup.sh /usr/local/bin/itop-setup
COPY --chmod=755 docker/itop-prod/itop-cron.sh /usr/local/bin/itop-cron

WORKDIR /var/www/html
VOLUME ["/var/www/html/conf", "/var/www/html/data", "/var/www/html/env-production", "/var/www/html/log"]

# Apache and PHP answer (any status: before itop-setup rest.php says 500).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sS -o /dev/null http://127.0.0.1/webservices/rest.php || exit 1

ENTRYPOINT ["itop-entrypoint"]
CMD ["apache2-foreground"]
